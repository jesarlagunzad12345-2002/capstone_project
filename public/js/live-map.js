const resortCoords = [10.7239, 122.3385];
let map, routingControl, userMarker, watchId;
let currentMode = 'car';
let firstFix = true;

const modeConfigs = {
    car: { engine: 'car', speed: 40, color: '#ff8c00' },
    moto: { engine: 'car', speed: 35, color: '#6f42c1' },
    bike: { engine: 'bicycle', speed: 15, color: '#28a745' },
    foot: { engine: 'foot', speed: 5, color: '#007bff' }
};

function initLiveMap() {
    map = L.map('live-map', { 
        zoomControl: false, 
        tap: false 
    }).setView(resortCoords, 16);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
    L.marker(resortCoords).addTo(map).bindPopup("KML Mountain Resort");

    startTracking();
}

function startTracking() {
    if (!navigator.geolocation) return alert("Enable GPS to use navigation.");

    watchId = navigator.geolocation.watchPosition((pos) => {
        const userLoc = L.latLng(pos.coords.latitude, pos.coords.longitude);
        
        updateUserMarker(userLoc);
        updateRoute(userLoc);

        if (firstFix) {
            map.flyTo(userLoc, 17);
            firstFix = false;
        }
    }, (err) => {
        document.getElementById('nav-status').innerText = "GPS Error";
        console.error(err);
    }, { enableHighAccuracy: true });
}

function updateUserMarker(latLng) {
    if (!userMarker) {
        userMarker = L.circleMarker(latLng, {
            radius: 10, fillColor: '#007bff', color: '#fff', weight: 3, fillOpacity: 1
        }).addTo(map);
    } else {
        userMarker.setLatLng(latLng);
    }
}

function updateRoute(userLoc) {
    let activeEngine = modeConfigs[currentMode].engine;
    const activeColor = modeConfigs[currentMode].color;
    const activeSpeed = modeConfigs[currentMode].speed;

    if (routingControl) map.removeControl(routingControl);

    routingControl = L.Routing.control({
        waypoints: [userLoc, L.latLng(resortCoords)],
        router: L.Routing.osrmv1({
            serviceUrl: `https://routing.openstreetmap.de/routed-${activeEngine}/route/v1`,
            timeout: 10000
        }),
        lineOptions: { 
            styles: [{ color: activeColor, weight: 8, opacity: 0.85 }] 
        },
        createMarker: () => null,
        addWaypoints: false
    })
    .on('routesfound', (e) => {
        const route = e.routes[0];
        const dist = route.summary.totalDistance / 1000;
        const time = Math.round((dist / activeSpeed) * 60);
    
        document.getElementById('eta-dist').innerText = dist.toFixed(1);
        document.getElementById('eta-time').innerText = time;
        
        const arrival = new Date(Date.now() + time * 60000);
        document.getElementById('eta-clock').innerText = arrival.toLocaleTimeString([], {
            hour: '2-digit', minute: '2-digit'
        });
        document.getElementById('nav-status').innerText = "GPS Active";
    })
    .on('routingerror', (err) => {
        if (currentMode === 'bike' && activeEngine !== 'foot') {
            console.warn("Cycling route failed (likely mountain trail), retrying with foot engine...");
            modeConfigs['bike'].engine = 'foot'; 
            updateRoute(userLoc); 
        } else {
            document.getElementById('nav-status').innerText = "Route Error";
            console.error(err);
        }
    })
    .addTo(map);
}

document.getElementById('recenterBtn').onclick = () => {
    if (userMarker) map.flyTo(userMarker.getLatLng(), 17);
};

document.querySelectorAll('.mode-item').forEach(btn => {
    btn.onclick = function() {
        document.querySelectorAll('.mode-item').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        
        currentMode = this.dataset.mode;
        if (currentMode === 'bike') modeConfigs['bike'].engine = 'bicycle';
        if (userMarker) updateRoute(userMarker.getLatLng());
    };
});

initLiveMap();