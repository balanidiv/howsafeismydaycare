(function (global) {
  var KEY = "AIzaSyBBYSljZW6mczj-ByrBSHP7Wvfyfkvh6gE";
  var mapsPromise = null;

  function asText(v) {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "object" && v.text) return String(v.text);
    return "";
  }

  function zip5(op) {
    return String((op && op.zipcode) || "").replace(/\s+/g, " ").trim().slice(0, 5);
  }

  function streetOf(op) {
    var loc = String((op && op.location_address) || "").replace(/\s+/g, " ").trim();
    var line = String((op && op.address_line) || "").replace(/\s+/g, " ").trim();
    return loc || line;
  }

  function textQuery(op) {
    var name = String((op && op.operation_name) || "").replace(/\s+/g, " ").trim();
    var street = streetOf(op);
    var city = String((op && op.city) || "").replace(/\s+/g, " ").trim();
    var st = String((op && op.state) || "TX").replace(/\s+/g, " ").trim() || "TX";
    var zip = zip5(op);
    var parts = [];
    if (name) parts.push(name);
    if (street) parts.push(street);
    if (city) parts.push(city);
    if (st) parts.push(st);
    if (zip) parts.push(zip);
    parts.push("child care");
    return parts.join(", ");
  }

  function biasLatLng(op) {
    if (String((op && op.city) || "").toUpperCase() === "AUSTIN") {
      return { lat: 30.2672, lng: -97.7431 };
    }
    return { lat: 31.0, lng: -99.9 };
  }

  function normReviews(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 5).map(function (rev) {
      return {
        author: asText(rev.authorAttribution && rev.authorAttribution.displayName) || rev.author_name || "Google user",
        rating: rev.rating,
        when: rev.relativePublishTimeDescription || rev.relative_time_description || "",
        text: asText(rev.text)
      };
    });
  }

  function hasQuotes(listing) {
    var revs = listing && listing.reviews;
    if (!Array.isArray(revs) || !revs.length) return false;
    return revs.some(function (r) { return r && String(r.text || "").trim(); });
  }

  function listingFromJsPlace(place) {
    if (!place) return null;
    return {
      id: place.id,
      name: asText(place.displayName) || "",
      address: place.formattedAddress || "",
      rating: place.rating,
      count: place.userRatingCount,
      maps: place.googleMapsURI || place.googleMapsUri || "",
      reviews: normReviews(place.reviews)
    };
  }

  function listingFromRest(p) {
    if (!p) return null;
    return {
      id: p.id,
      name: asText(p.displayName) || "",
      address: p.formattedAddress || "",
      rating: p.rating,
      count: p.userRatingCount,
      maps: p.googleMapsUri || p.googleMapsURI || "",
      reviews: normReviews(p.reviews)
    };
  }

  function listingFromLegacy(det, searchHit) {
    var src = det || searchHit || {};
    return {
      name: src.name || "",
      address: src.formatted_address || "",
      rating: src.rating,
      count: src.user_ratings_total,
      maps: src.url || "",
      reviews: normReviews(src.reviews)
    };
  }

  function loadMapsJs() {
    if (global.google && google.maps && google.maps.importLibrary) return Promise.resolve();
    if (mapsPromise) return mapsPromise;
    var p = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(KEY) +
        "&v=weekly&libraries=places";
      s.async = true;
      var t = setTimeout(function () { reject(new Error("Google Maps timed out")); }, 8000);
      s.onload = function () {
        clearTimeout(t);
        if (global.google && google.maps && google.maps.importLibrary) resolve();
        else reject(new Error("Google Maps loaded without importLibrary"));
      };
      s.onerror = function () {
        clearTimeout(t);
        reject(new Error("Google Maps failed to load"));
      };
      document.head.appendChild(s);
    });
    mapsPromise = p;
    p.catch(function () { if (mapsPromise === p) mapsPromise = null; });
    return p;
  }

  function withTimeout(promise, ms, msg) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error(msg || "timeout")); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  function searchNew(op, wantReviews) {
    return withTimeout(loadMapsJs().then(function () {
      return google.maps.importLibrary("places");
    }).then(function (lib) {
      var Place = lib.Place;
      var req = {
        textQuery: textQuery(op),
        fields: ["id", "displayName", "formattedAddress", "rating", "userRatingCount"],
        maxResultCount: 1,
        region: "us",
        language: "en",
        locationBias: biasLatLng(op)
      };
      return Place.searchByText(req).then(function (res) {
        var place = res && res.places && res.places[0];
        if (place) return place;
        var phone = String((op && op.phone_number) || "").replace(/\D/g, "");
        if (phone.length !== 10) return null;
        return Place.searchByText({
          textQuery: phone,
          fields: req.fields,
          maxResultCount: 1,
          region: "us"
        }).then(function (res2) {
          return (res2 && res2.places && res2.places[0]) || null;
        });
      }).then(function (place) {
        if (!place) return null;
        if (!wantReviews || typeof place.fetchFields !== "function") return listingFromJsPlace(place);
        return place.fetchFields({
          fields: ["displayName", "formattedAddress", "rating", "userRatingCount", "reviews", "googleMapsURI"]
        }).then(function (out) {
          return listingFromJsPlace((out && out.place) || place);
        }).catch(function () {
          return listingFromJsPlace(place);
        });
      });
    }), 10000, "Place.searchByText timed out");
  }

  function searchLegacy(op, wantReviews) {
    return withTimeout(loadMapsJs().then(function () {
      return google.maps.importLibrary("places");
    }).then(function () {
      return new Promise(function (resolve, reject) {
        if (!google.maps.places || !google.maps.places.PlacesService) {
          reject(new Error("Legacy PlacesService unavailable"));
          return;
        }
        var svc = new google.maps.places.PlacesService(document.createElement("div"));
        svc.textSearch({ query: textQuery(op) }, function (results, status) {
          if (status === "ZERO_RESULTS") { resolve(null); return; }
          if (status !== "OK" || !results || !results[0]) {
            if (status === "OK") { resolve(null); return; }
            reject(new Error(String(status || "PlacesService failed")));
            return;
          }
          var hit = results[0];
          if (!wantReviews) { resolve(listingFromLegacy(null, hit)); return; }
          svc.getDetails({
            placeId: hit.place_id,
            fields: ["name", "formatted_address", "rating", "user_ratings_total", "reviews", "url"]
          }, function (det, st) {
            if (st === "OK" && det) resolve(listingFromLegacy(det, hit));
            else resolve(listingFromLegacy(null, hit));
          });
        });
      });
    }), 10000, "PlacesService timed out");
  }

  function fetchRestDetails(listing) {
    if (!listing || !listing.id) return Promise.resolve(listing);
    return withTimeout(fetch("https://places.googleapis.com/v1/places/" + encodeURIComponent(listing.id), {
      headers: {
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,rating,userRatingCount,googleMapsUri,reviews"
      }
    }).then(function (res) {
      if (!res.ok) throw new Error("Places details " + res.status);
      return res.json();
    }).then(function (p) {
      var detailed = listingFromRest(p);
      if (!detailed) return listing;
      if (!hasQuotes(detailed)) detailed.reviews = listing.reviews || [];
      if (detailed.rating == null) detailed.rating = listing.rating;
      if (detailed.count == null) detailed.count = listing.count;
      if (!detailed.maps) detailed.maps = listing.maps;
      if (!detailed.name) detailed.name = listing.name;
      return detailed;
    }), 10000, "Places details timed out").catch(function () {
      return listing;
    });
  }

  function searchRest(op, wantReviews) {
    var mask = "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.googleMapsUri";
    if (wantReviews) mask += ",places.reviews";
    var bias = biasLatLng(op);
    var body = {
      textQuery: textQuery(op),
      maxResultCount: 1,
      languageCode: "en",
      regionCode: "us",
      locationBias: {
        circle: {
          center: { latitude: bias.lat, longitude: bias.lng },
          radius: 40000
        }
      }
    };
    return withTimeout(fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": KEY,
        "X-Goog-FieldMask": mask
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (!res.ok) throw new Error("Places REST " + res.status);
      return res.json();
    }).then(function (data) {
      var p = data && data.places && data.places[0];
      return p ? listingFromRest(p) : null;
    }), 10000, "Places REST timed out").then(function (listing) {
      if (!listing || !wantReviews || hasQuotes(listing)) return listing;
      return fetchRestDetails(listing);
    });
  }

  function findGoogleListing(op, opts) {
    var wantReviews = !(opts && opts.reviews === false);
    var lastErr = null;
    var sawEmpty = false;
    function tryFn(fn) {
      return fn().then(function (hit) {
        if (hit) return hit;
        sawEmpty = true;
        return null;
      }).catch(function (e) {
        lastErr = e;
        return null;
      });
    }
    function accept(hit) {
      if (!hit) return false;
      if (!wantReviews) return true;
      return hasQuotes(hit);
    }
    return tryFn(function () { return searchRest(op, wantReviews); })
      .then(function (hit) {
        if (accept(hit)) return hit;
        var restHit = hit;
        return tryFn(function () { return searchNew(op, wantReviews); }).then(function (jsHit) {
          if (accept(jsHit)) return jsHit;
          return tryFn(function () { return searchLegacy(op, wantReviews); }).then(function (leg) {
            if (accept(leg)) return leg;
            return restHit || jsHit || leg || null;
          });
        });
      })
      .then(function (hit) {
        if (hit) return hit;
        if (sawEmpty) return null;
        if (lastErr) throw lastErr;
        return null;
      });
  }

  global.findGoogleListing = findGoogleListing;
})(window);
