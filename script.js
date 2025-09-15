// Cafe Finder - Main Script
// Implements: Leaflet map, geolocation, Overpass API search, fallback JSON,
// Haversine distance sorting, sidebar <-> marker sync, search, and reset.

(function () {
  // ------------------------------
  // DOM references
  // ------------------------------
  const searchInput = document.getElementById('searchInput');
  const radiusSelect = document.getElementById('radiusSelect');
  const btnLocate = document.getElementById('btnLocate');
  const btnReset = document.getElementById('btnReset');
  const btnPick = document.getElementById('btnPick');
  const cafeListEl = document.getElementById('cafeList');
  const resultSummaryEl = document.getElementById('resultSummary');
  const spinnerEl = document.getElementById('spinner');

  // ------------------------------
  // Map setup
  // ------------------------------
  // Default view centered on India
  const INDIA_CENTER = [22.9734, 78.6569];
  const INDIA_ZOOM = 5;

  const map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
  }).setView(INDIA_CENTER, INDIA_ZOOM);

  // OpenStreetMap tiles via Leaflet
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  // Layers for markers
  const cafeLayer = L.layerGroup().addTo(map);
  let userMarker = null;

  // State
  let allCafes = []; // canonical fetched cafes
  let filteredCafes = []; // cafes after search filter
  let selectedCafeId = null;
  /** @type {Record<string, L.Marker>} */
  const idToMarker = {};
  /** @type {Record<string, HTMLElement>} */
  const idToCard = {};

  // ------------------------------
  // Utilities
  // ------------------------------
  function toKm(meters) {
    return Math.round((meters / 1000) * 100) / 100; // two decimals
  }

  // Haversine distance between two lat/lng points in meters
  function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // meters
    const toRad = (x) => (x * Math.PI) / 180;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);

    const a = Math.sin(Δφ / 2) ** 2 +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function setSummary(text) {
    resultSummaryEl.textContent = text;
  }

  function showSpinner(show) {
    if (!spinnerEl) return;
    spinnerEl.classList.toggle('hidden', !show);
    spinnerEl.setAttribute('aria-hidden', show ? 'false' : 'true');
  }

  function clearCafes() {
    cafeLayer.clearLayers();
    Object.keys(idToMarker).forEach((k) => delete idToMarker[k]);
    Object.keys(idToCard).forEach((k) => delete idToCard[k]);
    cafeListEl.innerHTML = '';
    selectedCafeId = null;
  }

  function selectCafe(cafeId, fly = true) {
    // highlight card
    Object.values(idToCard).forEach((el) => el.classList.remove('selected'));
    const card = idToCard[cafeId];
    if (card) {
      card.classList.add('selected');
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    // open marker
    const marker = idToMarker[cafeId];
    if (marker) {
      marker.openPopup();
      if (fly) map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.6 });
    }
    selectedCafeId = cafeId;
  }

  // ------------------------------
  // Rendering
  // ------------------------------
  function renderMarkers(cafes) {
    cafeLayer.clearLayers();
    Object.keys(idToMarker).forEach((k) => delete idToMarker[k]);

    cafes.forEach((cafe) => {
      const userLatLng = userMarker ? userMarker.getLatLng() : null;
      const directions = userLatLng
        ? `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${userLatLng.lat}%2C${userLatLng.lng}%3B${cafe.lat}%2C${cafe.lng}`
        : `https://www.openstreetmap.org/?mlat=${cafe.lat}&mlon=${cafe.lng}#map=17/${cafe.lat}/${cafe.lng}`;
      const stars = typeof cafe.rating === 'number' ? '★'.repeat(Math.round(cafe.rating)) + '☆'.repeat(5 - Math.round(cafe.rating)) : '';
      const popupHtml = `
        <div>
          <div style="font-weight:700;margin-bottom:4px">${cafe.name || 'Unnamed Cafe'}</div>
          ${cafe.address ? `<div>${cafe.address}</div>` : ''}
          ${cafe.contact ? `<div>☎ ${cafe.contact}</div>` : ''}
          ${stars ? `<div style=\"margin-top:4px;color:#fbbf24\">${stars}</div>` : ''}
          ${typeof cafe.distanceMeters === 'number' ? `<div style="margin-top:6px;color:#9ae6b4">${toKm(cafe.distanceMeters)} km away</div>` : ''}
          <div style="margin-top:8px"><a href="${directions}" target="_blank" rel="noopener">Directions ↗</a></div>
        </div>`;

      const marker = L.marker([cafe.lat, cafe.lng]);
      marker.bindPopup(popupHtml);
      marker.on('click', () => selectCafe(String(cafe.id), false));
      marker.addTo(cafeLayer);
      idToMarker[String(cafe.id)] = marker;
    });
  }

  function renderList(cafes) {
    cafeListEl.innerHTML = '';
    Object.keys(idToCard).forEach((k) => delete idToCard[k]);

    if (!cafes.length) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'cafe-card';
      emptyEl.innerHTML = '<div class="cafe-title">No cafes found</div><div class="cafe-meta">Try increasing radius or checking location permission.</div>';
      cafeListEl.appendChild(emptyEl);
      return;
    }

    cafes.forEach((cafe) => {
      const card = document.createElement('div');
      card.className = 'cafe-card';
      card.setAttribute('role', 'listitem');
      card.dataset.id = String(cafe.id);

      const title = document.createElement('div');
      title.className = 'cafe-title';
      title.textContent = cafe.name || 'Unnamed Cafe';

      const distance = document.createElement('div');
      distance.className = 'cafe-distance';
      distance.textContent = typeof cafe.distanceMeters === 'number' ? `${toKm(cafe.distanceMeters)} km` : '';

      const area = document.createElement('div');
      area.className = 'cafe-area';
      area.textContent = cafe.area || cafe.address || '';

      const meta = document.createElement('div');
      meta.className = 'cafe-meta';
      meta.textContent = cafe.contact ? `Contact: ${cafe.contact}` : '';

      card.appendChild(title);
      card.appendChild(distance);
      card.appendChild(area);
      card.appendChild(meta);

      card.addEventListener('click', () => selectCafe(String(cafe.id)));

      cafeListEl.appendChild(card);
      idToCard[String(cafe.id)] = card;
    });
  }

  function updateUI(cafes, from = 'search') {
    filteredCafes = cafes;
    renderMarkers(filteredCafes);
    renderList(filteredCafes);
    if (from !== 'search') setSummary(`${filteredCafes.length} cafe(s) found`);
  }

  // ------------------------------
  // Data loading
  // ------------------------------
  async function fetchOverpassCafes(lat, lon, radiusMeters) {
    // Overpass QL: fetch nodes/ways/relations with amenity=cafe around point
    // Include center for ways/relations for coordinates
    const query = `
      [out:json][timeout:25];
      (
        node["amenity"="cafe"](around:${radiusMeters},${lat},${lon});
        way["amenity"="cafe"](around:${radiusMeters},${lat},${lon});
        relation["amenity"="cafe"](around:${radiusMeters},${lat},${lon});
      );
      out tags center;`;

    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ data: query }).toString(),
    });
    if (!res.ok) throw new Error(`Overpass error ${res.status}`);
    const data = await res.json();
    const elements = Array.isArray(data.elements) ? data.elements : [];

    return elements
      .map((el) => {
        const { id, tags = {}, lat: nlat, lon: nlon, center } = el;
        const latLng = nlat && nlon ? { lat: nlat, lng: nlon } : (center || null);
        if (!latLng) return null;
        const addressParts = [tags['addr:housename'], tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'], tags['addr:city']]
          .filter(Boolean)
          .join(', ');
        return {
          id: String(id),
          name: tags.name || 'Cafe',
          area: tags['addr:suburb'] || tags['addr:city'] || '',
          address: addressParts,
          contact: tags['contact:phone'] || tags['phone'] || '',
          lat: latLng.lat,
          lng: latLng.lng,
        };
      })
      .filter(Boolean);
  }

  async function loadFallbackCafes() {
    const res = await fetch('./data/cafes.json');
    if (!res.ok) throw new Error('Failed to load fallback data');
    const items = await res.json();
    return items.map((c) => ({
      id: String(c.id),
      name: c.name,
      area: c.area || '',
      address: c.location || '',
      contact: c.contact || '',
      lat: c.lat,
      lng: c.lng,
      rating: c.rating,
    }));
  }

  function attachDistances(cafes, originLat, originLng) {
    cafes.forEach((c) => {
      c.distanceMeters = haversineDistance(originLat, originLng, c.lat, c.lng);
    });
    cafes.sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity));
  }

  function placeOrUpdateUserMarker(lat, lng) {
    const userPopup = 'You are here';
    if (userMarker) {
      userMarker.setLatLng([lat, lng]).setPopupContent(userPopup);
    } else {
      userMarker = L.marker([lat, lng], { title: 'Your location' }).addTo(map).bindPopup(userPopup);
    }
  }

  // ------------------------------
  // Interactions
  // ------------------------------
  async function handleFindNearMe() {
    if (!('geolocation' in navigator)) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

    setSummary('Locating you…');
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      const radiusMeters = Number(radiusSelect.value);
      placeOrUpdateUserMarker(latitude, longitude);
      map.setView([latitude, longitude], 14);

      try {
        showSpinner(true);
        setSummary('Searching nearby cafes…');
        const cafes = await fetchOverpassCafes(latitude, longitude, radiusMeters);
        if (!cafes.length) throw new Error('No Overpass results');
        attachDistances(cafes, latitude, longitude);
        allCafes = cafes;
        updateUI(allCafes, 'fetch');
      } catch (err) {
        console.warn('Overpass failed, using fallback data:', err);
        try {
          const fallback = await loadFallbackCafes();
          attachDistances(fallback, latitude, longitude);
          allCafes = fallback;
          updateUI(allCafes, 'fetch');
          setSummary('Showing fallback cafes');
        } catch (e2) {
          setSummary('Could not load cafes.');
          console.error(e2);
        }
      } finally { showSpinner(false); }
    }, (err) => {
      console.error(err);
      alert(`Unable to retrieve your location. ${err.message || ''} You can use "Pick on Map" to set a point manually.`);
      setSummary('Location permission needed. Or use Pick on Map.');
    }, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  }

  // Manual location picker: click on map to set your location and search
  function handlePickOnMap() {
    setSummary('Click on the map to set your location…');
    const tempClick = async (e) => {
      map.off('click', tempClick);
      const { lat, lng } = e.latlng;
      placeOrUpdateUserMarker(lat, lng);
      map.setView([lat, lng], 14);
      const radiusMeters = Number(radiusSelect.value);
      try {
        showSpinner(true);
        setSummary('Searching nearby cafes…');
        const cafes = await fetchOverpassCafes(lat, lng, radiusMeters);
        if (!cafes.length) throw new Error('No Overpass results');
        attachDistances(cafes, lat, lng);
        allCafes = cafes;
        updateUI(allCafes, 'fetch');
      } catch (err) {
        console.warn('Overpass failed, using fallback data:', err);
        try {
          const fallback = await loadFallbackCafes();
          attachDistances(fallback, lat, lng);
          allCafes = fallback;
          updateUI(allCafes, 'fetch');
          setSummary('Showing fallback cafes');
        } catch (e2) {
          setSummary('Could not load cafes.');
          console.error(e2);
        }
      } finally { showSpinner(false); }
    };
    map.on('click', tempClick);
  }

  function handleSearchInput() {
    const q = searchInput.value.trim().toLowerCase();
    if (!q) {
      updateUI(allCafes, 'search');
      setSummary(`${allCafes.length} cafe(s) found`);
      return;
    }
    const matches = allCafes.filter((c) =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.area || '').toLowerCase().includes(q)
    );
    updateUI(matches, 'search');
    setSummary(`${matches.length} result(s) for "${q}"`);
  }

  function handleReset() {
    searchInput.value = '';
    radiusSelect.value = '1000';
    clearCafes();
    if (userMarker) {
      map.removeLayer(userMarker);
      userMarker = null;
    }
    setSummary('Ready when you are.');
    map.setView(INDIA_CENTER, INDIA_ZOOM);
  }

  // Event bindings
  btnLocate.addEventListener('click', handleFindNearMe);
  btnReset.addEventListener('click', handleReset);
  btnPick.addEventListener('click', handlePickOnMap);
  searchInput.addEventListener('input', handleSearchInput);


  // ---------------------------------
  // Persist preferences (radius, last location)
  // ---------------------------------
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem('cf_prefs') || '{}');
      if (p.radius) radiusSelect.value = String(p.radius);
      if (p.lastLat && p.lastLng) {
        placeOrUpdateUserMarker(p.lastLat, p.lastLng);
        map.setView([p.lastLat, p.lastLng], 13);
      }
    } catch {}
  }
  function savePrefs(partial) {
    const p = JSON.parse(localStorage.getItem('cf_prefs') || '{}');
    localStorage.setItem('cf_prefs', JSON.stringify({ ...p, ...partial }));
  }
  radiusSelect.addEventListener('change', () => savePrefs({ radius: Number(radiusSelect.value) }));

  // Save location whenever we set the user marker
  const _placeOrUpdate = placeOrUpdateUserMarker;
  placeOrUpdateUserMarker = function(lat, lng) { _placeOrUpdate(lat, lng); savePrefs({ lastLat: lat, lastLng: lng }); };

  // Initial state
  setSummary('Ready when you are.');
  // Ensure the map renders correctly after initial paint and on resizes
  // Some preview environments/layout shifts require manual invalidation
  const invalidate = () => map.invalidateSize(false);
  window.addEventListener('load', () => setTimeout(invalidate, 0));
  window.addEventListener('resize', () => setTimeout(invalidate, 100));
  loadPrefs();
})();


