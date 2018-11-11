importScripts('js/idb.js');

var cacheID = "mws-restaurant-01";
let dbReady = false;

const dbPromise = idb.open("mu-restaurant-review", 5, upgradeDB => {
  console.log('Making a new object store.');
  switch (upgradeDB.oldVersion) {
    case 0:
      upgradeDB.createObjectStore("restaurants", {keyPath: "id"});
    case 1:
      {
        const reviewsStore = upgradeDB.createObjectStore("reviews", {keyPath: "id"});
        reviewsStore.createIndex("restaurant_id", "restaurant_id");
      }
    case 2:
      upgradeDB.createObjectStore("pending", {
        keyPath: "id",
        autoIncrement: true
      });
  }
});

var CACHE_NAME = 'my-restaurant-cache-v1';
var urlsToCache = [
  '/',
  'js/dbhelper.js',
  'js/main.js',
  'js/idb.js',
  'js/restaurant_info.js',
  'css/styles.css',
  'css/customs.css',
  'index.html',
  'img/tiles/1_1x.jpg',
  'img/tiles/2_1x.jpg',
  'img/tiles/3_1x.jpg',
  'img/tiles/4_1x.jpg',
  'img/tiles/5_1x.jpg',
  'img/tiles/6_1x.jpg',
  'img/tiles/7_1x.jpg',
  'img/tiles/8_1x.jpg',
  'img/tiles/9_1x.jpg',
  'img/tiles/10_1x.jpg',
  'img/ssForMapOptimized.png'
];

self.addEventListener('install', event => {
  // Perform install steps
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      }).catch((error) => {
        console.error('Failed to cache', error);
      })
  );
});

self.addEventListener("fetch", event => {
  let cacheRequest = event.request;
  let cacheUrlObj = new URL(event.request.url);
  if (event.request.url.indexOf("restaurant.html") > -1) {
    const cacheURL = "restaurant.html";
    cacheRequest = new Request(cacheURL);
  }

  // Requests going to the API get handled separately from those going to other
  // destinations
  const checkURL = new URL(event.request.url);
  if (checkURL.port === "1337") {
    const parts = checkURL
      .pathname
      .split("/");
    let id = checkURL
      .searchParams
      .get("restaurant_id") - 0;
    if (!id) {
      if (checkURL.pathname.indexOf("restaurants")) {
        id = parts[parts.length - 1] === "restaurants"
          ? "-1"
          : parts[parts.length - 1];
      } else {
        id = checkURL
          .searchParams
          .get("restaurant_id");
      }
    }
    handleAJAXEvent(event, id);
  } else {
    handleNonAJAXEvent(event, cacheRequest);
  }
});

const handleAJAXEvent = (event, id) => {
  // Only use caching for GET events
  if (event.request.method !== "GET") {
    return fetch(event.request)
      .then(fetchResponse => fetchResponse.json())
      .then(json => {
        return json
      });
  }

  // Split these request for handling restaurants vs reviews
  if (event.request.url.indexOf("reviews") > -1) {
    handleReviewsEvent(event, id);
  } else {
    handleRestaurantEvent(event, id);
  }
}

const handleReviewsEvent = (event, id) => {
  event.respondWith(dbPromise.then(db => {
    return db
      .transaction("reviews")
      .objectStore("reviews")
      .index("restaurant_id")
      .getAll(id);
  }).then(data => {
    return (data.length && data) || fetch(event.request)
      .then(fetchResponse => fetchResponse.json())
      .then(data => {
        return dbPromise.then(idb => {
          const itx = idb.transaction("reviews", "readwrite");
          const store = itx.objectStore("reviews");
          data.forEach(review => {
            store.put({id: review.id, "restaurant_id": review["restaurant_id"], data: review});
          })
          return data;
        })
      })
  }).then(finalResponse => {
    if (finalResponse[0].data) {
      // Need to transform the data to the proper format
      const mapResponse = finalResponse.map(review => review.data);
      return new Response(JSON.stringify(mapResponse));
    }
    return new Response(JSON.stringify(finalResponse));
  }).catch(error => {
    return new Response("Error fetching data", {status: 500})
  }))
}

const handleRestaurantEvent = (event, id) => {
  // Check the IndexedDB to see if the JSON for the API has already been stored
  // there. If so, return that. If not, request it from the API, store it, and
  // then return it back.
  event.respondWith(dbPromise.then(db => {
    return db
      .transaction("restaurants")
      .objectStore("restaurants")
      .get(id);
  }).then(data => {
    return (data && data.data) || fetch(event.request)
      .then(fetchResponse => fetchResponse.json())
      .then(json => {
        return dbPromise.then(db => {
          const tx = db.transaction("restaurants", "readwrite");
          const store = tx.objectStore("restaurants");
          store.put({id: id, data: json});
          return json;
        });
      });
  }).then(finalResponse => {
    return new Response(JSON.stringify(finalResponse));
  }).catch(error => {
    return new Response("Error fetching data", {status: 500});
  }));
};

const handleNonAJAXEvent = (event, cacheRequest) => {
  // Check if the HTML request has previously been cached. If so, return the
  // response from the cache. If not, fetch the request, cache it, and then return
  // it.
  event.respondWith(caches.match(cacheRequest).then(response => {
    return (response || fetch(event.request).then(fetchResponse => {
      return caches
        .open(cacheID)
        .then(cache => {
          if (fetchResponse.url.indexOf("browser-sync") === -1) {
            cache.put(event.request, fetchResponse.clone());
          }
          return fetchResponse;
        });
    }).catch(error => {
      if (event.request.url.indexOf(".jpg") > -1) {
        return caches.match("/img/na.png");
      }
      return new Response("Application is not connected to the internet", {
        status: 404,
        statusText: "Application is not connected to the internet"
      });
    }));
  }));
};