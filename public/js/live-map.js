const resortCoords = [10.7239, 122.3385];
let map;
let routingControl;
let userLayer;
let watchId;
let currentMode = 'car';
let firstFix = true;

// ========== NEW: Throttling variables to fix mobile blinking ==========
let lastRouteTime = 0;        // Timestamp of last successful route
let lastRoutePos = null;      // Position of last successful route
let isCalculatingRoute = false; // Prevents overlapping route requests
let routeRequestPos = null;   // Position used for current route request

const MIN_ROUTE_INTERVAL = 3000;   // Wait at least 3 seconds between requests
const MIN_ROUTE_DISTANCE = 15;     // Only recalculate if moved 15+ meters
// =====================================================================

const modeConfigs = {
    car:  { engine: 'car',      speed: 40, color: '#ff8c00' },
    moto: { engine: 'car',      speed: 35, color: '#8b5cf6' },
    bike: { engine: 'bicycle',  speed: 15, color: '#22c55e' },
    foot: { engine: 'foot',     speed: 5,  color: '#3b82f6' }
};

/* ---------- Popup Functions (unchanged) ---------- */
function openResortPopup() {
    document.getElementById('resortPopup').classList.add('active');
}
function closeResortPopup() {
    document.getElementById('resortPopup').classList.remove('active');
}

document.addEventListener('click', function(event) {
    const popup = document.getElementById('resortPopup');
    const clickedOnPopup = popup.contains(event.target);
    const clickedOnMarker = event.target.closest('.leaflet-marker-icon');
    const clickedOnUserMarker = event.target.closest('.user-location-marker');
    if (popup.classList.contains('active') && !clickedOnPopup && !clickedOnMarker && !clickedOnUserMarker) {
        closeResortPopup();
    }
});

document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeResortPopup();
    }
});

/* ---------- Custom User Location Marker (unchanged) ---------- */
const UserLayer = L.Layer.extend({
    initialize: function(ll, h) {
        this._ll = L.latLng(ll);
    },
    setLatLng: function(ll) {
        this._ll = L.latLng(ll);
        return this.redraw();
    },
    onAdd: function(map) {
        this._map = map;
        this._svg = L.SVG.create('svg');
        this._svg.setAttribute('class', 'user-location-marker');
        this._svg.style.cssText = 'position:absolute; pointer-events:none; overflow:visible';
        this._dot = L.SVG.create('circle');
        this._dot.setAttribute('fill', '#3b82f6');
        this._dot.setAttribute('stroke', '#fff');
        this._dot.setAttribute('stroke-width', '2.5');
        this._svg.appendChild(this._dot);
        this.getPane().appendChild(this._svg);
        map.on('zoom', this.redraw, this);
        return this.redraw();
    },
    onRemove: function(map) {
        map.off('zoom', this.redraw, this);
        if (this._svg.parentNode) {
            this._svg.parentNode.removeChild(this._svg);
        }
    },
    redraw: function() {
        if (!this._map) return this;
        const pos = this._map.latLngToLayerPoint(this._ll);
        const zoom = this._map.getZoom();
        const size = Math.max(40, Math.min(80, Math.round(60 * (zoom - 10) / 10 + 60)));
        this._svg.style.left = (pos.x - size / 2) + 'px';
        this._svg.style.top  = (pos.y - size / 2) + 'px';
        this._svg.setAttribute('width', size);
        this._svg.setAttribute('height', size);
        this._svg.setAttribute('viewBox', `${-size/2} ${-size/2} ${size} ${size}`);
        this._dot.setAttribute('r', size * 0.12);
        return this;
    },
    getLatLng: function() {
        return this._ll;
    }
});

function updateUser(latLng) {
    if (!userLayer) {
        userLayer = new UserLayer(latLng).addTo(map);
    } else {
        userLayer.setLatLng(latLng);
    }
}

/* ---------- Map Init (unchanged) ---------- */
function initLiveMap() {
    map = L.map('live-map', { zoomControl: false, tap: false }).setView(resortCoords, 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    L.marker(resortCoords).addTo(map).on('click', function(event) {
        L.DomEvent.stopPropagation(event);
        openResortPopup();
    });
    startTracking();
}

/* ---------- GPS Tracking (unchanged logic, just calls throttled updateRoute) ---------- */
function startTracking() {
    if (!navigator.geolocation) {
        alert("Geolocation is not supported by your browser. Please enable GPS.");
        return;
    }
    watchId = navigator.geolocation.watchPosition(
        function(position) {
            const latLng = L.latLng(position.coords.latitude, position.coords.longitude);
            updateUser(latLng);
            updateRoute(latLng);   // Now throttled - won't blink!
            if (firstFix) {
                map.flyTo(latLng, 17);
                firstFix = false;
            }
        },
        function(error) {
            document.getElementById('nav-status').innerText = "GPS Error";
            console.error("GPS Error:", error);
        },
        {
            enableHighAccuracy: true,
            maximumAge: 1000,
            timeout: 10000
        }
    );
}

/* ========== NEW: Throttled Route Update ========== */
function updateRoute(userLocation, forceRecreate = false) {
    const now = Date.now();

    // If a route request is already in flight, don't start another one
    if (isCalculatingRoute) {
        return;
    }

    // If not forcing (like on mode change), apply throttle rules
    if (!forceRecreate) {
        // Rule 1: Time - wait at least 3 seconds between route requests
        if (now - lastRouteTime < MIN_ROUTE_INTERVAL) {
            return;
        }

        // Rule 2: Distance - only recalculate if user moved 15+ meters
        // This stops mobile GPS jitter from constantly redrawing the route
        if (lastRoutePos && userLocation.distanceTo(lastRoutePos) < MIN_ROUTE_DISTANCE) {
            return;
        }
    }

    // Save the position we're requesting this route for
    routeRequestPos = L.latLng(userLocation.lat, userLocation.lng);
    isCalculatingRoute = true;

    // If control already exists and we're not changing mode, just update waypoints
    // This is the KEY FIX - setWaypoints() updates smoothly WITHOUT blinking
    if (routingControl && !forceRecreate) {
        routingControl.setWaypoints([routeRequestPos, L.latLng(resortCoords)]);
    } else {
        // Force recreate: remove old control first (used when switching travel modes)
        if (routingControl) {
            map.removeControl(routingControl);
            routingControl = null;
        }
        createRoutingControl();
    }
}

/* ========== NEW: Create Routing Control (only called once, or on mode change) ========== */
function createRoutingControl() {
    const config = modeConfigs[currentMode];

    routingControl = L.Routing.control({
        waypoints: [routeRequestPos, L.latLng(resortCoords)],
        router: L.Routing.osrmv1({
            serviceUrl: `https://routing.openstreetmap.de/routed-${config.engine}/route/v1`,
            timeout: 10000
        }),
        lineOptions: {
            styles: [{ color: config.color, weight: 8, opacity: 0.85 }]
        },
        createMarker: function() { return null; },
        addWaypoints: false
    })
    .on('routesfound', function(event) {
        isCalculatingRoute = false;

        const route = event.routes[0];
        const distanceKm = route.summary.totalDistance / 1000;
        const timeMinutes = Math.round(distanceKm / modeConfigs[currentMode].speed * 60);
        const arrivalTime = new Date(Date.now() + timeMinutes * 60000);

        document.getElementById('eta-dist').innerText = distanceKm.toFixed(1);
        document.getElementById('eta-time').innerText = timeMinutes;
        document.getElementById('eta-clock').innerText = arrivalTime.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
        document.getElementById('nav-status').innerText = "GPS Active";

        // Remember when and where this successful route was calculated
        lastRouteTime = Date.now();
        lastRoutePos = routeRequestPos;
    })
    .on('routingerror', function(event) {
        isCalculatingRoute = false;
        const error = event.error || event;
        console.error("Routing error:", error);

        // Bike fallback: if bicycle engine fails, try foot engine
        if (currentMode === 'bike' && modeConfigs.bike.engine !== 'foot') {
            modeConfigs.bike.engine = 'foot';
            // Must recreate control to use the new engine
            if (routingControl) {
                map.removeControl(routingControl);
                routingControl = null;
            }
            if (userLayer) {
                updateRoute(userLayer.getLatLng(), true);
            }
            return;
        }

        // Don't permanently show "Route Error" - keep GPS Active so the user
        // knows tracking still works. Next successful route will clear this.
        document.getElementById('nav-status').innerText = "GPS Active";
    })
    .addTo(map);
}
/* ============================================================ */

/* ---------- Recenter Button (unchanged) ---------- */
document.getElementById('recenterBtn').onclick = function() {
    if (userLayer) {
        map.flyTo(userLayer.getLatLng(), 17);
    }
};

/* ---------- Mode Buttons - force recreation when mode changes ---------- */
document.querySelectorAll('.mode-item').forEach(function(button) {
    button.onclick = function() {
        document.querySelectorAll('.mode-item').forEach(function(btn) {
            btn.classList.remove('active');
        });
        this.classList.add('active');
        currentMode = this.dataset.mode;
        if (currentMode === 'bike') {
            modeConfigs.bike.engine = 'bicycle';
        }
        if (userLayer) {
            // true = force recreate so new color and router engine apply
            updateRoute(userLayer.getLatLng(), true);
        }
    };
});

function exitPopup() {
    closeResortPopup();
}

initLiveMap();