// ============================================================
// متغیرهای جهانی
// ============================================================
let map = null;
let currentOverallRisk = 0;
let currentScores = { overall: 0, flood: 0, earthquake: 0, landslide: 0, subsidence: 0, lightning: 0, storm: 0, temperature: 0, aviation: 0 };
let marker = null;
let radarChart = null, barChart = null, precipChart = null, windChart = null, tempChart = null;
const WORKER_URL = 'https://nassaproxyv2.behnam-zamani.workers.dev';
const MONTH_NAMES_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

// متغیرهای کش برای ذخیره داده‌های GeoJSON
let riverDataCache = null;
let citiesSubsidenceCache = null;
let hanoverSubsidenceCache = null;
let airportsCache = null;
let airwaysCache = null;
let lightningCache = null;
let faultsCache = null;

// ============================================================
// راه‌اندازی نقشه و مارکر
// ============================================================
function updateMarker(lat, lon) {
    if (!map) return;
    if (marker) map.removeLayer(marker);
    marker = L.marker([lat, lon], { draggable: true }).addTo(map);
    marker.on('dragend', function(e) {
        const pos = e.target.getLatLng();
        document.getElementById('lat').value = pos.lat.toFixed(4);
        document.getElementById('lon').value = pos.lng.toFixed(4);
        updateURL(pos.lat.toFixed(4), pos.lng.toFixed(4));
    });
}

function initMap() {
    const urlParams = new URLSearchParams(window.location.search);
    let initialLat = parseFloat(urlParams.get('lat')) || parseFloat(document.getElementById('lat').value) || 35.6892;
    let initialLon = parseFloat(urlParams.get('lon')) || parseFloat(document.getElementById('lon').value) || 51.3890;

    document.getElementById('lat').value = initialLat.toFixed(4);
    document.getElementById('lon').value = initialLon.toFixed(4);

    map = L.map('map').setView([initialLat, initialLon], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
    updateMarker(initialLat, initialLon);

    map.on('click', function(e) {
        const lat = e.latlng.lat.toFixed(4);
        const lon = e.latlng.lng.toFixed(4);
        document.getElementById('lat').value = lat;
        document.getElementById('lon').value = lon;
        updateMarker(parseFloat(lat), parseFloat(lon));
        updateURL(lat, lon);
    });

    document.getElementById('lat').addEventListener('change', function() {
        syncMapWithInputs();
        updateURL(this.value, document.getElementById('lon').value);
    });
    document.getElementById('lon').addEventListener('change', function() {
        syncMapWithInputs();
        updateURL(document.getElementById('lat').value, this.value);
    });
}

function syncMapWithInputs() {
    const lat = parseFloat(document.getElementById('lat').value);
    const lon = parseFloat(document.getElementById('lon').value);
    if (!isNaN(lat) && !isNaN(lon) && map) {
        map.setView([lat, lon], 14);
        updateMarker(lat, lon);
    }
}

// ============================================================
// مدیریت آدرس (URL) و GPS
// ============================================================
function updateURL(lat, lon) {
    if (!lat || !lon) return;
    const newUrl = `${window.location.pathname}?lat=${lat}&lon=${lon}`;
    window.history.replaceState({ path: newUrl }, '', newUrl);
}

function getLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                const lat = position.coords.latitude.toFixed(4);
                const lon = position.coords.longitude.toFixed(4);
                document.getElementById('lat').value = lat;
                document.getElementById('lon').value = lon;
                if (map) { map.setView([lat, lon], 15); updateMarker(parseFloat(lat), parseFloat(lon)); }
                updateURL(lat, lon);
                alert('موقعیت شما با موفقیت دریافت شد.');
            },
            function(error) { alert('خطا در دریافت موقعیت: ' + error.message); },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    } else { alert('مرورگر شما از GPS پشتیبانی نمی‌کند.'); }
}

// ============================================================
// مدیریت توکن NASA
// ============================================================
function loadToken() {
    const token = localStorage.getItem('nasa_token');
    const input = document.getElementById('nasaToken');
    const status = document.getElementById('tokenStatus');
    if (token) { input.value = token; status.textContent = '✅ توکن ذخیره شده است'; status.className = 'token-status ok'; }
    else { status.textContent = '⚠️ توکن وارد نشده.'; status.className = 'token-status missing'; }
}
function saveToken() {
    const token = document.getElementById('nasaToken').value.trim();
    const status = document.getElementById('tokenStatus');
    if (token) { localStorage.setItem('nasa_token', token); status.textContent = '✅ توکن ذخیره شد'; status.className = 'token-status ok'; }
    else { localStorage.removeItem('nasa_token'); status.textContent = '⚠️ توکن وارد نشده.'; status.className = 'token-status missing'; }
}
function getToken() { return document.getElementById('nasaToken').value.trim() || localStorage.getItem('nasa_token') || ''; }

// ============================================================
// جستجوی هوشمند (مکان و شرکت)
// ============================================================
let searchTimeout = null;
function setupSmartSearch() {
    const input = document.getElementById('searchInput');
    const resultsDiv = document.getElementById('searchResults');
    if (!input || !resultsDiv) return;
    input.addEventListener('input', function() {
        const query = this.value.trim();
        if (searchTimeout) clearTimeout(searchTimeout);
        if (query.length < 2) { resultsDiv.classList.remove('show'); resultsDiv.innerHTML = ''; return; }
        searchTimeout = setTimeout(() => performSmartSearch(query), 400);
    });
    document.addEventListener('click', function(e) { if (!e.target.closest('.search-box')) resultsDiv.classList.remove('show'); });
}
async function performSmartSearch(query) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '<div class="search-loading">⏳ در حال جستجو...</div>'; resultsDiv.classList.add('show');
    try {
        const [places, companies] = await Promise.allSettled([searchPlace(query), searchCompany(query)]);
        const allResults = [];
        if (places.status === 'fulfilled' && places.value) places.value.forEach(p => allResults.push({ ...p, source: 'place' }));
        if (companies.status === 'fulfilled' && companies.value) companies.value.forEach(c => allResults.push({ ...c, source: 'company' }));
        if (allResults.length === 0) { resultsDiv.innerHTML = '<div class="search-no-result">❌ نتیجه‌ای یافت نشد</div>'; return; }
        resultsDiv.innerHTML = allResults.slice(0, 8).map((item) => {
            const icon = item.source === 'company' ? '🏢' : '📍';
            return '<div class="search-result-item" onclick="selectSearchResult(' + item.lat + ', ' + item.lon + ')"><div class="icon">' + icon + '</div><div class="info"><div class="name">' + item.displayName.split(',')[0] + '</div><div class="address">' + item.displayName + '</div></div></div>';
        }).join('');
    } catch (e) { resultsDiv.innerHTML = '<div class="search-no-result">❌ خطا در جستجو</div>'; }
}
async function searchPlace(query) {
    const url = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(query) + '&format=json&limit=5&countrycodes=ir&accept-language=fa';
    try { const res = await fetch(url, { headers: { 'User-Agent': 'MultiHazardApp/1.0' } }); if (!res.ok) return []; const data = await res.json(); return data.map(item => ({ lat: parseFloat(item.lat), lon: parseFloat(item.lon), displayName: item.display_name })); } catch (e) { return []; }
}
async function searchCompany(query) {
    const safeQuery = query.replace(/["\\]/g, '');
    const q = '[out:json][timeout:25];(node["office"="company"]["name"~"' + safeQuery + '",i](around:100000););out center 5;';
    const url = WORKER_URL + '/?url=' + encodeURIComponent('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q));
    try { const res = await fetch(url); if (!res.ok) return []; const data = await res.json(); return (data.elements || []).map(el => ({ lat: el.lat || el.center.lat, lon: el.lon || el.center.lon, displayName: (el.tags && el.tags.name) || 'شرکت' })); } catch (e) { return []; }
}
function selectSearchResult(lat, lon) {
    document.getElementById('lat').value = lat.toFixed(4); document.getElementById('lon').value = lon.toFixed(4);
    if (map) { map.setView([lat, lon], 14); updateMarker(lat, lon); }
    document.getElementById('searchResults').classList.remove('show'); document.getElementById('searchInput').value = '';
}
// ============================================================
// دریافت داده‌های محیطی (ارتفاع، بارش، دما، باد)
// ============================================================
async function getElevation(lat, lon) {
    try { const res = await fetch('https://api.open-meteo.com/v1/elevation?latitude=' + lat + '&longitude=' + lon); if (!res.ok) return null; const data = await res.json(); return data.elevation[0]; } catch (e) { return null; }
}

async function getPrecipitation(lat, lon) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&daily=precipitation_sum&past_days=10&forecast_days=1&timezone=auto';
    try { const res = await fetch(url); if (!res.ok) return null; const data = await res.json(); const precip = data.daily.precipitation_sum.filter(v => v !== null); if (precip.length === 0) return null; return { avg: precip.reduce((a, b) => a + b, 0) / precip.length, max: Math.max(...precip) }; } catch (e) { return null; }
}

// ============================================================
// دریافت داده‌های CAPE و پیش‌بینی هواشناسی (برای صاعقه)
// ============================================================
async function getCapeData(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=cape&forecast_days=7&timezone=auto`;
    try {
        const res = await fetch(url); if (!res.ok) return null; const data = await res.json();
        if (!data.hourly || !data.hourly.cape) return null;
        let total = 0, count = 0;
        data.hourly.cape.forEach(val => { if (val !== null && val !== undefined) { total += val; count++; } });
        return count > 0 ? (total / count) : null;
    } catch (e) { return null; }
}

async function getForecastData(lat, lon) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=precipitation_sum,wind_speed_10m_max,temperature_2m_max,temperature_2m_min,snowfall_sum,weather_code&forecast_days=3&timezone=auto`;
    try {
        const res = await fetch(url); if (!res.ok) return null; const data = await res.json(); return data.daily;
    } catch (e) { return null; }
}

// ============================================================
// دریافت داده‌های اقلیمی ۲۰ ساله (دما، بارش، باد)
// ============================================================
async function getClimateData(lat, lon) {
    const now = new Date(); const endYear = now.getFullYear() - 1; const startYear = endYear - 19;
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${startYear}-01-01&end_date=${endYear}-12-31&daily=precipitation_sum,temperature_2m_mean,wind_speed_10m_mean&wind_speed_unit=kmh&timezone=auto`;
    try {
        const res = await fetch(url); if (!res.ok) return null; const data = await res.json(); if (!data.daily) return null;
        const precip = data.daily.precipitation_sum; const temp = data.daily.temperature_2m_mean; const wind = data.daily.wind_speed_10m_mean; 
        const monthlyPrecip = Array(12).fill(0); const monthlyTemp = Array(12).fill(0); const monthlyWind = Array(12).fill(0); const counts = Array(12).fill(0); const yearlyTotals = {};
        data.daily.time.forEach((t, i) => {
            const date = new Date(t); const year = date.getFullYear(); const month = date.getMonth();
            if (precip[i] !== null) { if (!yearlyTotals[year]) yearlyTotals[year] = Array(12).fill(0); yearlyTotals[year][month] += precip[i]; }
            if (temp[i] !== null) { monthlyTemp[month] += temp[i]; counts[month]++; }
            if (wind[i] !== null) { monthlyWind[month] += wind[i]; }
        });
        const years = Object.keys(yearlyTotals); const avgMonthlyPrecip = Array(12).fill(0);
        years.forEach(y => { for(let m=0; m<12; m++) avgMonthlyPrecip[m] += yearlyTotals[y][m]; });
        for(let m=0; m<12; m++) avgMonthlyPrecip[m] /= years.length;
        const annualPrecipAvg = avgMonthlyPrecip.reduce((a, b) => a + b, 0);
        const sumSq = avgMonthlyPrecip.reduce((a, b) => a + b*b, 0);
        const pci = annualPrecipAvg > 0 ? (sumSq / (annualPrecipAvg * annualPrecipAvg)) * 100 : 0;
        for(let m=0; m<12; m++) if(counts[m]>0) monthlyTemp[m] /= counts[m];
        const annualTempAvg = monthlyTemp.reduce((a,b)=>a+b,0) / 12;
        const avgDaysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        for(let m=0; m<12; m++) monthlyWind[m] /= (years.length * avgDaysInMonth[m]);
        const annualWindAvgKmh = monthlyWind.reduce((a,b)=>a+b,0) / 12;
        const windiestMonthIndex = monthlyWind.indexOf(Math.max(...monthlyWind));
        const monthOrder = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1];
        return { precip: { monthly: monthOrder.map(m=>avgMonthlyPrecip[m]), annualAvg: annualPrecipAvg, pci: pci }, temp: { monthly: monthOrder.map(m=>monthlyTemp[m]), annualAvg: annualTempAvg }, wind: { monthly: monthOrder.map(m=>monthlyWind[m]), annualAvg: annualWindAvgKmh, windiestMonth: MONTH_NAMES_FA[monthOrder.indexOf(windiestMonthIndex)] } };
    } catch (e) { return null; }
}

// ============================================================
// محاسبه شیب و Vs30
// ============================================================
async function estimateSlope(lat, lon) {
    const delta = 0.01; const points = [{ lat: lat + delta, lon: lon }, { lat: lat - delta, lon: lon }, { lat: lat, lon: lon + delta }, { lat: lat, lon: lon - delta }];
    const centerElev = await getElevation(lat, lon); if (centerElev === null) return null;
    const elevs = await Promise.all(points.map(p => getElevation(p.lat, p.lon))); if (elevs.some(e => e === null)) return null;
    const dLat = delta * 111000; const dLon = delta * 111000 * Math.cos(lat * Math.PI / 180);
    const gradN = (elevs[0] - centerElev) / dLat, gradS = (centerElev - elevs[1]) / dLat; const gradE = (elevs[2] - centerElev) / dLon, gradW = (centerElev - elevs[3]) / dLon;
    return { slopePercent: Math.sqrt(Math.pow((gradN + gradS) / 2, 2) + Math.pow((gradE + gradW) / 2, 2)) * 100 };
}
async function getVs30Estimate(slopePercent) { if (slopePercent === null) return 300; if (slopePercent > 15) return 760; else if (slopePercent > 5) return 450; else return 250; }

// ============================================================
// دریافت دبی رودخانه (GloFAS)
// ============================================================
async function getFloodDischarge(lat, lon) {
    const offsets = [{ lat: lat, lon: lon }, { lat: lat + 0.1, lon: lon }, { lat: lat - 0.1, lon: lon }, { lat: lat, lon: lon + 0.1 }, { lat: lat, lon: lon - 0.1 }];
    let bestDischarge = null, bestRatio = 0;
    for (const point of offsets) {
        const url = `https://flood-api.open-meteo.com/v1/flood?latitude=${point.lat}&longitude=${point.lon}&daily=river_discharge,river_discharge_max&past_days=30&forecast_days=7&timezone=auto`;
        try {
            const res = await fetch(url); if (!res.ok) continue; const data = await res.json(); if (!data.daily || !data.daily.river_discharge) continue;
            const discharge = data.daily.river_discharge.filter(v => v !== null); if (discharge.length === 0) continue;
            const current = discharge[discharge.length - 1]; if (current < 1 || current > 5000) continue;
            const avg = discharge.reduce((a, b) => a + b, 0) / discharge.length; const ratio = avg > 0 ? current / avg : 0;
            if (current > bestDischarge || bestDischarge === null) { bestDischarge = current; bestRatio = ratio; }
        } catch (e) { continue; }
    }
    if (bestDischarge === null) return null; return { current: bestDischarge, avg: bestDischarge / (bestRatio || 1), ratio: bestRatio };
}
// ============================================================
// دریافت NDVI و کاربری اراضی (از طریق NASA)
// ============================================================
async function getNDVI(lat, lon, token) {
    if (!token) return null; const nasaUrl = 'https://modis.ornl.gov/rst/api/v1/MOD13Q1/subset?latitude=' + lat + '&longitude=' + lon + '&band=250m_16_days_NDVI&startDate=A2023001&endDate=A2023096&kmAboveBelow=1&kmLeftRight=1';
    const url = WORKER_URL + '/?url=' + encodeURIComponent(nasaUrl);
    try {
        const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' } }); if (!res.ok) return null; const data = await res.json(); if (!data.subset || data.subset.length === 0) return null;
        const scale = parseFloat(data.scale) || 0.0001; let vals = [];
        data.subset.forEach(item => {
            const raw = item.value !== undefined ? item.value : item.data; if (raw === undefined || raw === null) return; const num = parseFloat(raw);
            if (!isNaN(num) && num !== -3000) { const scaled = num * scale; if (scaled >= -1 && scaled <= 1) vals.push(scaled); }
        });
        return vals.length ? { avg: vals.reduce((a, b) => a + b, 0) / vals.length } : null;
    } catch (e) { return null; }
}

async function getLandCover(lat, lon, token) {
    if (!token) return null; const nasaUrl = 'https://modis.ornl.gov/rst/api/v1/MCD12Q1/subset?latitude=' + lat + '&longitude=' + lon + '&band=LC_Type1&startDate=A2022001&endDate=A2022365&kmAboveBelow=1&kmLeftRight=1';
    const url = WORKER_URL + '/?url=' + encodeURIComponent(nasaUrl);
    try {
        const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' } }); if (!res.ok) return null; const data = await res.json(); if (!data.subset || data.subset.length === 0) return null;
        const counts = {};
        data.subset.forEach(item => { const code = parseInt(item.value !== undefined ? item.value : item.data); if (!isNaN(code) && code !== 255) counts[code] = (counts[code] || 0) + 1; });
        let dom = null, max = 0; for (const c in counts) if (counts[c] > max) { max = counts[c]; dom = parseInt(c); }
        const info = getLandCoverInfo(dom); return { code: dom, name: info.name, floodScore: info.floodScore };
    } catch (e) { return null; }
}

function getLandCoverInfo(code) {
    const m = { 1:{name:'جنگل سوزنی‌برگ',floodScore:1}, 2:{name:'جنگل پهن‌برگ',floodScore:1}, 3:{name:'جنگل خزان‌کننده',floodScore:2}, 4:{name:'جنگل پهن‌برگ خزان',floodScore:2}, 5:{name:'جنگل مختلط',floodScore:2}, 6:{name:'بیشه‌زار',floodScore:4}, 7:{name:'بوته‌زار',floodScore:5}, 8:{name:'ساوانا',floodScore:5}, 9:{name:'ساوانا',floodScore:6}, 10:{name:'مرتع',floodScore:6}, 11:{name:'تالاب',floodScore:9}, 12:{name:'زمین زراعی',floodScore:7}, 13:{name:'زمین شهری',floodScore:10}, 14:{name:'زراعت',floodScore:6}, 15:{name:'برف',floodScore:3}, 16:{name:'بایر',floodScore:4}, 17:{name:'پهنه آبی',floodScore:10} };
    return m[code] || { name: 'نامشخص', floodScore: 5 };
}

// ============================================================
// محاسبه فاصله از رودخانه (با استفاده از داده‌های GeoJSON)
// ============================================================
async function loadRiverData() { if (riverDataCache) return riverDataCache; try { const res = await fetch('iran-rivers.geojson'); if (!res.ok) return null; riverDataCache = await res.json(); return riverDataCache; } catch(e) { return null; } }

async function getRiverDistance(lat, lon) {
    const data = await loadRiverData(); if (!data || !data.features) return { found: false, distanceText: 'داده در دسترس نیست' };
    const pt = turf.point([lon, lat]); let minD = Infinity, nearest = null;
    data.features.forEach(f => {
        if (!f.geometry || (f.geometry.type !== 'LineString' && f.geometry.type !== 'MultiLineString')) return;
        const b = turf.bbox(f); if (b[0] > lon+0.5 || b[2] < lon-0.5 || b[1] > lat+0.5 || b[3] < lat-0.5) return;
        try { const d = turf.pointToLineDistance(pt, f, {units:'meters'}); if (d < minD) { minD = d; nearest = f; } } catch(e) {}
    });
    if (!nearest) return { found: false, distanceText: 'بیش از ۵۰ کیلومتر' };
    return { found: true, distance: minD, distanceText: minD < 1000 ? minD.toFixed(0)+' متر' : (minD/1000).toFixed(2)+' کیلومتر', name: nearest.properties?.name || 'بدون نام' };
}

// ============================================================
// داده‌های فرونشست زمین (شهری و هانوفر)
// ============================================================
async function loadCitiesData() { if (citiesSubsidenceCache) return citiesSubsidenceCache; try { const res = await fetch('iran-subsidence-cities.geojson'); if (!res.ok) return null; citiesSubsidenceCache = await res.json(); return citiesSubsidenceCache; } catch (e) { return null; } }
async function loadHanoverData() { if (hanoverSubsidenceCache) return hanoverSubsidenceCache; try { const res = await fetch('iran-subsidence.geojson'); if (!res.ok) return null; hanoverSubsidenceCache = await res.json(); return hanoverSubsidenceCache; } catch (e) { return null; } }

async function getSubsidenceData(lat, lon) {
    const userPoint = turf.point([lon, lat]);
    const citiesData = await loadCitiesData();
    if (citiesData && citiesData.features) {
        let minDist = Infinity, nearest = null, chosenRadius = 50;
        citiesData.features.forEach(f => {
            if (!f.geometry || f.geometry.type !== 'Point') return;
            const dist = turf.distance(userPoint, f, { units: 'kilometers' }); const radius = f.properties.radius || 50; 
            if (dist <= radius && dist < minDist) { minDist = dist; nearest = f; chosenRadius = radius; }
        });
        if (nearest) { let rate = null; for (const key in nearest.properties) { if (key.includes('SAMPLE') || key.includes('VALUE')) { rate = parseFloat(nearest.properties[key]); break; } } if (rate !== null && !isNaN(rate)) return { rate: rate, distance: minDist, found: true, source: 'city', radius: chosenRadius }; }
    }
    const hanoverData = await loadHanoverData();
    if (hanoverData && hanoverData.features) {
        let minDist = Infinity, nearest = null;
        hanoverData.features.forEach(f => {
            if (!f.geometry || f.geometry.type !== 'Point') return;
            const dist = turf.distance(userPoint, f, { units: 'kilometers' }); if (dist < minDist) { minDist = dist; nearest = f; }
        });
        if (nearest) { let rate = null; for (const key in nearest.properties) { if (key.includes('SAMPLE') || key.includes('VALUE')) { rate = parseFloat(nearest.properties[key]); break; } } if (rate !== null && !isNaN(rate)) return { rate: rate, distance: minDist, found: true, source: 'hanover', radius: 'unlimited' }; }
    }
    return { found: false, message: 'داده فرونشست در دسترس نیست.' };
}

// ============================================================
// هوانوردی (فرودگاه‌ها و دالان‌های هوایی)
// ============================================================
async function loadAirports() { if (airportsCache) return airportsCache; try { const res = await fetch('iran-airports.geojson'); if (!res.ok) return null; airportsCache = await res.json(); return airportsCache; } catch (e) { return null; } }
async function loadAirwaysData() { if (airwaysCache) return airwaysCache; try { const res = await fetch('iran-airways.geojson'); if (!res.ok) return null; airwaysCache = await res.json(); return airwaysCache; } catch (e) { return null; } }

async function getAirwayDistance(lat, lon) {
    const airwaysData = await loadAirwaysData(); if (!airwaysData || !airwaysData.features) return null;
    const pt = turf.point([lon, lat]); let minD = Infinity, nearestAirway = null;
    airwaysData.features.forEach(f => {
        if (!f.geometry) return;
        if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
            try { const d = turf.pointToLineDistance(pt, f, { units: 'kilometers' }); if (d < minD) { minD = d; nearestAirway = f.properties.name || 'دالان بدون نام'; } } catch (e) {}
        } 
    });
    if (nearestAirway === null) return null; return { distance: minD, name: nearestAirway };
}

async function getAviationRisk(lat, lon) {
    const userPoint = turf.point([lon, lat]); const airportsData = await loadAirports();
    let airportScore = 1; let airportText = 'داده فرودگاه در دسترس نیست'; let nearestName = ''; let minDist = Infinity;
    if (airportsData && airportsData.features && airportsData.features.length > 0) {
        airportsData.features.forEach(f => {
            if (!f.geometry || f.geometry.type !== 'Point') return;
            const dist = turf.distance(userPoint, f, { units: 'kilometers' });
            if (dist < minDist) { minDist = dist; nearestName = (f.properties && f.properties.name) || 'فرودگاه بدون نام'; }
        });
        if (minDist <= 5) airportScore = 5; else if (minDist <= 10) airportScore = 4; else if (minDist <= 20) airportScore = 3; else if (minDist <= 40) airportScore = 2; else airportScore = 1;
        airportText = `فاصله تا نزدیک‌ترین فرودگاه (${nearestName}): ${minDist.toFixed(1)} کیلومتر`;
    }
    const airwayData = await getAirwayDistance(lat, lon); let finalScore = airportScore; let finalText = airportText;
    if (airwayData) {
        if (airwayData.distance <= 5) finalScore += 2; else if (airwayData.distance <= 15) finalScore += 1;
        finalText += ` | فاصله تا دالان (${airwayData.name}): ${airwayData.distance.toFixed(1)} کیلومتر`;
    }
    finalScore = Math.min(5, finalScore);
    return { score: finalScore, text: finalText, nearestName: nearestName, distance: minDist };
}

// ============================================================
// داده‌های زلزله و چگالی صاعقه
// ============================================================
async function loadLightningData() {
    if (lightningCache) return lightningCache;
    try { const res = await fetch('iran-lightning-density.geojson'); if (!res.ok) return null; lightningCache = await res.json(); return lightningCache; } catch (e) { return null; }
}
async function loadFaultsData() {
    if (faultsCache) return faultsCache;
    try {
        const res = await fetch('iran-faults.geojson');
        if (!res.ok) return null;
        faultsCache = await res.json();
        return faultsCache;
    } catch (e) { return null; }
}

async function getEarthquakeData(lat, lon) {
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&latitude=${lat}&longitude=${lon}&maxradiuskm=150&minmagnitude=4.0&starttime=1900-01-01&limit=100`;
    let quakes = []; try { const res = await fetch(url); if (res.ok) quakes = (await res.json()).features || []; } catch(e) {}
       // محاسبه دقیق فاصله تا گسل با استفاده از داده‌های GeoJSON
    let faultDistance = 50; // مقدار پیش‌فرض اگر داده‌ای نبود
    const faultsData = await loadFaultsData();
    
    if (faultsData && faultsData.features) {
        const userPoint = turf.point([lon, lat]);
        let minDist = Infinity;
        
        faultsData.features.forEach(f => {
            if (!f.geometry) return;
            if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') {
                try {
                    const d = turf.pointToLineDistance(userPoint, f, { units: 'kilometers' });
                    if (d < minDist) minDist = d;
                } catch (e) {}
            }
        });
        
        if (minDist !== Infinity) {
            faultDistance = minDist;
        }
    }
    let maxMag = 0, nearest = { dist: 9999, mag: 0 }; let recentQuakes = [];
    if (quakes.length > 0) {
        const qData = quakes.map(q => ({ mag: q.properties.mag, dist: haversine(lat, lon, q.geometry.coordinates[1], q.geometry.coordinates[0]) / 1000, time: q.properties.time, date: new Date(q.properties.time).toLocaleDateString('fa-IR') }));
        maxMag = Math.max(...qData.map(q=>q.mag)); nearest = qData.reduce((min,q)=>q.dist<min.dist?q:min, qData[0]);
        qData.sort((a, b) => b.time - a.time); recentQuakes = qData.slice(0, 10); 
    }
    return { maxMag, nearest, faultDistance, recentQuakes };
}

function haversine(lat1, lon1, lat2, lon2) { const R=6371000, t=d=>d*Math.PI/180, dLat=t(lat2-lat1), dLon=t(lon2-lon1); const a=Math.sin(dLat/2)**2 + Math.cos(t(lat1))*Math.cos(t(lat2))*Math.sin(dLon/2)**2; return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); }
// ============================================================
// تحلیل و امتیازدهی یکپارچه (analyzeAll)
// ============================================================
async function analyzeAll() {
    const lat = parseFloat(document.getElementById('lat').value);
    const lon = parseFloat(document.getElementById('lon').value);
    if (isNaN(lat) || isNaN(lon)) return alert('مختصات معتبر وارد کنید');
    
    document.getElementById('loading').style.display = 'block';
    document.getElementById('result').classList.remove('show');
    
    // 🌟 محاسبه چگالی صاعقه (قبل از شروع تحلیل اصلی)
    let lightningDensity = null;
    const lightningData = await loadLightningData();
    if (lightningData && lightningData.features) {
        const userPoint = turf.point([lon, lat]);
        let minDist = Infinity;
        lightningData.features.forEach(f => {
            const d = turf.distance(userPoint, f, { units: 'kilometers' });
            if (d < minDist && d < 100) { 
                minDist = d; 
                lightningDensity = f.properties.density; 
            }
        });
    }

    const token = getToken();

    try {
        // اجرای همزمان تمام درخواست‌ها
        const results = await Promise.allSettled([
            getElevation(lat, lon), 
            estimateSlope(lat, lon), 
            getClimateData(lat, lon), 
            getPrecipitation(lat, lon), 
            getFloodDischarge(lat, lon), 
            getNDVI(lat, lon, token), 
            getLandCover(lat, lon, token), 
            getRiverDistance(lat, lon), 
            getEarthquakeData(lat, lon), 
            getSubsidenceData(lat, lon), 
            getAviationRisk(lat, lon), 
            getCapeData(lat, lon), 
            getForecastData(lat, lon)
        ]);

        const getVal = (index) => results[index].status === 'fulfilled' ? results[index].value : null;
        const autoElevation = getVal(0); 
        const slopeData = getVal(1); 
        const climate = getVal(2); 
        const recentPrecip = getVal(3); 
        const discharge = getVal(4);
        const ndvi = getVal(5); 
        const landCover = getVal(6); 
        const river = getVal(7); 
        const eqData = getVal(8); 
        const subsidenceData = getVal(9);
        const aviationData = getVal(10); 
        const capeData = getVal(11); 
        const forecastData = getVal(12);

        document.getElementById('loading').style.display = 'none';
        if (autoElevation === null) { alert("خطا در دریافت ارتفاع از سطح دریا از سرور"); return; }
        
        const slopePercent = slopeData ? slopeData.slopePercent : null;
        const vs30 = await getVs30Estimate(slopePercent);

        // --- محاسبه امتیاز سیل (fScore) ---
        let fScore = 1;
        if (climate) {
            if (climate.precip.annualAvg > 700) fScore = 4;
            else if (climate.precip.annualAvg > 500) fScore = 3;
            else if (climate.precip.annualAvg > 300) fScore = 2;
            if (climate.precip.pci > 25) fScore += 0.5;
        }
        if (discharge && discharge.ratio > 2) fScore += 0.5;
        if (river && river.found && river.distance < 500) fScore += 0.5;
        
        if (ndvi && typeof ndvi.avg !== 'undefined') {
            if (ndvi.avg < 0.1) fScore += 0.5; else if (ndvi.avg < 0.2) fScore += 0.25;
        }
        if (landCover && typeof landCover.floodScore !== 'undefined') {
            if (landCover.floodScore >= 9) fScore += 1; else if (landCover.floodScore >= 7) fScore += 0.5; else if (landCover.floodScore <= 2) fScore -= 0.5;
        }
        if (recentPrecip) {
            if (recentPrecip.avg > 10) fScore += 0.5; else if (recentPrecip.avg > 5) fScore += 0.25;
        }

        let climateType = 'نامشخص';
        if (climate) {
            const annualPrecip = climate.precip.annualAvg; const annualTemp = climate.temp.annualAvg;
            if (annualPrecip < 100 && annualTemp > 18) { climateType = 'بیابانی (خشک)'; fScore += 0.5; }
            else if (annualPrecip < 300) { climateType = 'نیمه‌خشک (استپی)'; fScore += 0.25; }
            else if (annualPrecip > 700) { climateType = 'مرطوب (پربارش)'; }
            else { climateType = 'مدیترانه‌ای (معتدل)'; }
        }
        fScore = Math.min(5, fScore);

        // --- محاسبه امتیاز زلزله (eScore) ---
        let eScore = 1;
        if (eqData.maxMag >= 6) eScore = 4; else if (eqData.maxMag >= 5) eScore = 3; else if (eqData.maxMag >= 4) eScore = 2;
        if (eqData.faultDistance < 20) eScore += 0.5;
        if (vs30 < 300) eScore += 0.5;
        eScore = Math.min(5, eScore);

        // --- محاسبه امتیاز رانش (landScore) ---
        let landScore = 1;
        if (slopePercent) { if (slopePercent > 15) landScore = 4; else if (slopePercent > 5) landScore = 3; else if (slopePercent > 2) landScore = 2; }
        if (climate && climate.precip.annualAvg > 700) landScore += 0.5;
        landScore = Math.min(5, landScore);

        // --- محاسبه امتیاز فرونشست (subScore) ---
        let subScore = 1; let subsidenceText = '';
        if (subsidenceData && subsidenceData.found) {
            const absRate = Math.abs(subsidenceData.rate);
            if (absRate > 20) subScore = 5; else if (absRate > 10) subScore = 4; else if (absRate > 5) subScore = 3; else if (absRate > 2) subScore = 2; else subScore = 1;
            const sourceLabel = (subsidenceData.source === 'city') ? 'داده شهری' : 'داده ماهواره‌ای';
            subsidenceText = `نرخ فرونشست: ${absRate.toFixed(1)} سانتی‌متر در سال (منبع: ${sourceLabel}، فاصله: ${subsidenceData.distance.toFixed(1)} کیلومتر)`;
        } else if (subsidenceData && subsidenceData.message) {
            subsidenceText = `⚠️ ${subsidenceData.message}`;
        } else {
            if (lat > 35 && lat < 36 && lon > 51 && lon < 52) subScore = 3.5; else if (lat > 32 && lat < 36 && lon > 50 && lon < 55) subScore = 4.5;
            subsidenceText = 'داده فرونشست در دسترس نیست (تخمین بر اساس منطقه).';
        }

        // --- محاسبه امتیاز صاعقه (lScore) ---
        const buildingHeight = parseFloat(document.getElementById('buildingHeight').value) || 0;
        let lScore = 1;
        if (climate) {
            if (climate.precip.annualAvg > 700) lScore = 3; else if (climate.precip.annualAvg > 300) lScore = 2;
            if (typeof capeData !== 'undefined' && capeData !== null) { if (capeData > 2000) lScore += 2; else if (capeData > 1000) lScore += 1; if (capeData > 1000 && climate.precip.annualAvg < 100) lScore -= 0.5; }
            if (autoElevation > 2000) lScore += 1; else if (autoElevation > 1000) lScore += 0.5;
            if (buildingHeight > 30) lScore += 1; else if (buildingHeight > 10) lScore += 0.5;
        }
                    // 🌟 تأثیر چگالی واقعی آذرخش (تعداد صاعقه در کیلومتر مربع در سال)
            if (lightningDensity !== null) {
                const annualDensity = lightningDensity * 365; // تبدیل به واحد سالانه
                if (annualDensity > 5) lScore += 2;
                else if (annualDensity > 2) lScore += 1;
                else if (annualDensity > 1) lScore += 0.5;
            }
        lScore = Math.min(5, Math.max(1, lScore));

        // --- محاسبه امتیاز طوفان (wScore) و دما (tScore) ---
        let wScore = 1; if (climate) { if (climate.wind.annualAvg > 30) wScore = 4; else if (climate.wind.annualAvg > 15) wScore = 2.5; }
        let tScore = 1.9; if (climate) { if (climate.temp.annualAvg > 25 || climate.temp.annualAvg < 5) tScore = 3; }
        
        const avScore = aviationData ? aviationData.score : 1;
        const scores = [fScore, eScore, landScore, subScore, lScore, wScore, tScore, avScore];
        const overall = scores.reduce((a,b)=>a+b,0) / scores.length;
                // 🌟 ذخیره امتیازها برای محاسبه‌گر نرخ
                currentScores = {
            overall: overall,
            flood: fScore,
            earthquake: eScore,
            landslide: landScore,
            subsidence: subScore,
            lightning: lScore,
            storm: wScore,
            temperature: tScore,
            aviation: avScore
        };
        
        // 🌟 نمایش کادر محاسبه‌گر نرخ
        document.getElementById('premiumCalculator').style.display = 'block';
        document.getElementById('premiumResult').innerHTML = '';  

        // --- نمایش ریسک کلی ---
        document.getElementById('overallRisk').textContent = overall >= 4 ? '🔴 ریسک کلی: بالا' : overall >= 2.5 ? '🟡 ریسک کلی: متوسط' : '🟢 ریسک کلی: پایین';
        document.getElementById('overallScore').innerHTML = `<strong>نمره کلی: ${overall.toFixed(1)} از ۵</strong>`;

        const getClass = v => v >= 4 ? 'very-high' : v >= 3 ? 'high' : v >= 2 ? 'medium' : 'low';
        document.getElementById('hazardCards').innerHTML = `
            <div class="hazard-card"><h4>🌊 سیل</h4><div class="score ${getClass(fScore)}">${fScore.toFixed(1)}</div></div>
            <div class="hazard-card"><h4>🌍 زلزله</h4><div class="score ${getClass(eScore)}">${eScore.toFixed(1)}</div></div>
            <div class="hazard-card"><h4>⛰️ رانش زمین</h4><div class="score ${getClass(landScore)}">${landScore.toFixed(1)}</div></div>
            <div class="hazard-card"><h4>📉 فرونشست زمین</h4><div class="score ${getClass(subScore)}">${subScore.toFixed(1)}</div></div>
            <div class="hazard-card"><h4>⚡ صاعقه</h4><div class="score ${getClass(lScore)}">${lScore.toFixed(1)}</div></div>
            <div class="hazard-card"><h4>🌪️ طوفان</h4><div class="score ${getClass(wScore)}">${wScore.toFixed(1)}</div></div>
            <div class="hazard-card"><h4>🌡️ دما</h4><div class="score ${getClass(tScore)}">${tScore.toFixed(1)}</div></div>
            <div class="hazard-card"><h4>✈️ هوانوردی</h4><div class="score ${getClass(avScore)}">${avScore.toFixed(1)}</div></div>
        `;

        drawRadarChart(scores); 
        drawBarChart(scores);
        if (climate) { drawPrecipChart(climate.precip.monthly); drawWindChart(climate.wind.monthly); drawTempChart(climate.temp.monthly); }
      
        // 🌟 استایل مشترک برای کادرهای داخلی
        const boxStyle = `style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 15px; margin-bottom: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.05);"`;

        // --- تولید کدهای HTML برای جزئیات تحلیل ---
        let html = '<h3>📋 جزئیات تحلیل</h3>';
        
        // ============================================================
        // کادر اصلی اول: تحلیل تاریخی (گذشته‌نگر)
        // ============================================================
        html += `<div style="background: #f7fafc; border: 2px solid #cbd5e0; border-radius: 15px; padding: 20px; margin-bottom: 30px;">`;
        html += `<h2 style="color: #2c5282; text-align: center; margin-bottom: 20px; font-size: 22px;">📜 تحلیل داده‌های تاریخی (Historical Analysis)</h2>`;
        
        // بخش سیل
        html += `<div ${boxStyle}>`;
        html += `<h4>🌊 سیل</h4><ul>`;
        if (climate) html += `<li>میانگین بارش سالانه (۲۰ ساله): ${climate.precip.annualAvg.toFixed(1)} mm</li><li>PCI (شاخص تمرکز بارش): ${climate.precip.pci.toFixed(1)}</li><li>نوع اقلیم: ${climateType}</li>`;
        if (discharge) {
            html += `<li>دبی GloFAS: ${discharge.current.toFixed(1)} m³/s</li>`;
        } else {
            html += `<li style="color: #dd6b20;">⚠️ داده دبی GloFAS برای این نقطه معتبر نیست.</li>`;
        }
        if (ndvi) html += `<li>NDVI (شاخص پوشش گیاهی): ${ndvi.avg.toFixed(3)}</li>`;
        if (landCover) html += `<li>کاربری اراضی (نوع پوشش زمین): ${landCover.name}</li>`;
        if (river && river.found) html += `<li>فاصله از رودخانه: ${river.distanceText}</li>`;
        if (recentPrecip) html += `<li>بارش ۱۰ روز اخیر: ${recentPrecip.avg.toFixed(2)} mm</li>`;
        html += `</ul></div>`;

        // بخش زلزله
        html += `<div ${boxStyle}>`;
        html += `<h4>🌍 زلزله</h4><ul><li>فاصله تا گسل: ${eqData.faultDistance.toFixed(2)} km</li><li>Vs30 (سرعت موج برشی خاک): ${vs30} m/s</li></ul>`;
        if (eqData.recentQuakes.length > 0) {
            const maxMagRecent = Math.max(...eqData.recentQuakes.map(q => q.mag));
            html += `<table style="width:100%; border-collapse: collapse; margin-top: 10px; font-size: 13px;">
                     <thead><tr style="background-color: #edf2f7;">
                         <th style="border: 1px solid #cbd5e0; padding: 5px;">تاریخ</th>
                         <th style="border: 1px solid #cbd5e0; padding: 5px;">بزرگا (ریشتر)</th>
                         <th style="border: 1px solid #cbd5e0; padding: 5px;">فاصله (km)</th>
                     </tr></thead><tbody>`;
            eqData.recentQuakes.forEach(q => {
                const isMax = (q.mag === maxMagRecent);
                const rowStyle = isMax ? 'background-color: #fed7d7; font-weight: bold; color: #c53030;' : '';
                html += `<tr style="${rowStyle}">
                            <td style="border: 1px solid #cbd5e0; padding: 5px; text-align: center;">${q.date}</td>
                            <td style="border: 1px solid #cbd5e0; padding: 5px; text-align: center;">${q.mag.toFixed(1)}</td>
                            <td style="border: 1px solid #cbd5e0; padding: 5px; text-align: center;">${q.dist.toFixed(1)}</td>
                         </tr>`;
            });
            html += `</tbody></table>`;
        }
                // 🌟 نمایش نقشه زلزله با استفاده از Leaflet Image Overlay
        html += `<div style="text-align: center; margin-top: 15px;">`;
        html += `<div id="eqMapOverlay" style="width: 100%; height: 400px; border-radius: 8px; border: 1px solid #cbd5e0;"></div>`;
        html += `<p style="font-size: 12px; color: #718096; margin-top: 5px;">نقشه توزیع زلزله (نقطه قرمز: محل انتخابی)</p>`;
        html += `</div>`;
        
        // فراخوانی تابع برای رسم نقشه (با تاخیر برای اطمینان از لود شدن HTML)
        setTimeout(() => showMapWithOverlay(lat, lon), 100);

                // 🌟 نمایش نقشه PGA (شتاب زمین)
        html += `<div style="text-align: center; margin-top: 15px;">`;
        html += `<div id="pgaMapOverlay" style="width: 100%; height: 400px; border-radius: 8px; border: 1px solid #cbd5e0;"></div>`;
        html += `<p style="font-size: 12px; color: #718096; margin-top: 5px;">نقشه شتاب اوج زمین (PGA) - احتمال ۵۰ ساله (نقطه قرمز: محل انتخابی)</p>`;
        html += `</div>`;
        
        setTimeout(() => showPgaMapWithOverlay(lat, lon), 200);
        
        // فراخوانی تابع برای رسم دایره
        setTimeout(() => drawMarkerOnImage('eqMapContainer', lat, lon), 100);

        // بخش توپوگرافی
        html += `<div ${boxStyle}>`;
        html += `<h4>🏔️ توپوگرافی</h4><ul>
                    <li>ارتفاع از سطح دریا: ${autoElevation.toFixed(0)} متر</li>
                    <li>شیب تقریبی: ${slopePercent ? slopePercent.toFixed(1) : 'نامشخص'}%</li>
                 </ul></div>`;

        // بخش فرونشست
        html += `<div ${boxStyle}>`;
        html += `<h4>📉 فرونشست زمین</h4><ul><li>${subsidenceText}</li></ul></div>`;

        // بخش طوفان و دما
        html += `<div ${boxStyle}>`;
        html += `<h4>🌪️ طوفان و 🌡️ دما</h4><ul>`;
        if (climate) {
            html += `<li>میانگین سرعت طوفان: ${climate.wind.annualAvg.toFixed(1)} km/h</li><li>میانگین دما: ${climate.temp.annualAvg.toFixed(1)} C°</li>`;
        } else {
            html += `<li style="color: #dd6b20;">⚠️ داده‌های اقلیمی دریافت نشد.</li>`;
        }
        html += `</ul></div>`;

        // بخش صاعقه
        html += `<div ${boxStyle}>`;
        html += `<h4>⚡ صاعقه</h4><ul>`;
        if (climate) {
            html += `<li>میانگین بارش سالانه (۲۰ ساله): ${climate.precip.annualAvg.toFixed(1)} mm</li>`;
            if (typeof capeData !== 'undefined' && capeData !== null) {
                html += `<li>انرژی همرفتی (CAPE - پتانسیل رعد و برق): ${capeData.toFixed(0)} J/kg</li>`;
            } else {
                html += `<li>انرژی همرفتی (CAPE): داده‌ای ثبت نشده</li>`;
            }
            if (lightningDensity !== null) {
                const annualDensity = lightningDensity * 365;
                html += `<li>چگالی آذرخش (میانگین سالانه): ${annualDensity.toFixed(1)} صاعقه در هر کیلومتر مربع</li>`;
            }
            html += `<li>ارتفاع از سطح دریا: ${autoElevation.toFixed(0)} متر</li>`;
            html += `<li>ارتفاع سازه: ${buildingHeight} متر</li>`;
        } else {
            html += `<li style="color: #dd6b20;">⚠️ داده‌های اقلیمی دریافت نشد.</li>`;
        }
        html += `<li>امتیاز نهایی صاعقه: ${lScore.toFixed(1)}</li></ul>`;
        html += `<div style="text-align: center; margin-top: 15px;">`;
        html += `<img src="lightning-map.png" alt="نقشه توزیع آذرخش ایران" style="width: 100%; max-width: 600px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">`;
        html += `<p style="font-size: 12px; color: #718096; margin-top: 5px;">نقشه میانگین چگالی آذرخش (منبع: دیتاست WGLC)</p></div>`;
        html += `</div>`;

        // بخش هوانوردی
        html += `<div ${boxStyle}>`;
        html += `<h4>✈️ خطر هوانوردی</h4><ul><li>${aviationData ? aviationData.text : 'داده در دسترس نیست'}</li></ul></div>`;

        // بستن کادر اول
        html += `</div>`; 


        // ============================================================
        // کادر اصلی دوم: تحلیل آینده‌نگر (پیش‌بینی)
        // ============================================================
        html += `<div style="background: #ebf8ff; border: 2px solid #90cdf4; border-radius: 15px; padding: 20px; margin-bottom: 30px;">`;
        html += `<h2 style="color: #2b6cb0; text-align: center; margin-bottom: 20px; font-size: 22px;">🔮 تحلیل آینده‌نگر (Prospective Analysis)</h2>`;
        
        html += `<div ${boxStyle}>`;
        html += `<h4>🚨 هشدارهای پیش‌بینی (۳ روز آینده)</h4><ul>`;
        if (forecastData) {
            let hasAlert = false;
            const maxPrecip = Math.max(...forecastData.precipitation_sum);
            const maxWind = Math.max(...forecastData.wind_speed_10m_max);
            const maxTemp = Math.max(...forecastData.temperature_2m_max);
            const minTemp = Math.min(...forecastData.temperature_2m_min);
            const totalSnow = forecastData.snowfall_sum.reduce((a, b) => a + (b || 0), 0);
            const hasThunder = forecastData.weather_code.some(c => c >= 95);

            if (maxPrecip > 50) { html += `<li style="color: #e53e3e; font-weight: bold;">⚠️ هشدار سیل: پیش‌بینی بارش ${maxPrecip.toFixed(1)} میلی‌متر!</li>`; hasAlert = true; }
            else if (maxPrecip > 20) { html += `<li style="color: #dd6b20;">🌧️ بارش قابل توجه: ${maxPrecip.toFixed(1)} میلی‌متر.</li>`; hasAlert = true; }
            if (maxWind > 60) { html += `<li style="color: #e53e3e; font-weight: bold;">⚠️ هشدار طوفان: سرعت باد تا ${maxWind.toFixed(1)} km/h!</li>`; hasAlert = true; }
            if (maxTemp > 40) { html += `<li style="color: #e53e3e; font-weight: bold;">⚠️ هشدار گرمای شدید: دما تا ${maxTemp.toFixed(1)} درجه!</li>`; hasAlert = true; }
            if (minTemp < 0) { html += `<li style="color: #3182ce;">❄️ هشدار یخبندان: دمای حداقل ${minTemp.toFixed(1)} درجه!</li>`; hasAlert = true; }
            if (totalSnow > 5) { html += `<li style="color: #3182ce;">⛄ هشدار بارش برف: مجموع ${totalSnow.toFixed(1)} سانتی‌متر!</li>`; hasAlert = true; }
            if (hasThunder) { html += `<li style="color: #805ad5;">⚡ احتمال رعد و برق در ۳ روز آینده!</li>`; hasAlert = true; }
            if (!hasAlert) { html += `<li style="color: #38a169;">✅ وضعیت جوی پیش‌رو در سطح ایمن است.</li>`; }
        } else {
            html += `<li>⚠️ داده‌های پیش‌بینی در دسترس نیست.</li>`;
        }
        html += `</ul></div>`;
        
        // بستن کادر دوم
        html += `</div>`;

        document.getElementById('paramDetails').innerHTML = html;
        generateInsuranceAssistant(eScore, subScore, lScore, fScore, landScore, avScore, climate);
        document.getElementById('result').classList.add('show');

    } catch (e) {
        console.error(e);
        alert('خطا در تحلیل: ' + e.message);
        document.getElementById('loading').style.display = 'none';
    }
}
// ============================================================
// رسم نمودارها
// ============================================================
function drawRadarChart(s) { 
    const ctx = document.getElementById('radarChart').getContext('2d'); 
    if (radarChart) radarChart.destroy(); 
    radarChart = new Chart(ctx, { 
        type: 'radar', 
        data: { 
            labels: ['سیل','زلزله','رانش زمین','فرونشست زمین','صاعقه','طوفان','دما','هوانوردی'], 
            datasets: [{ label: 'امتیاز', data: s, backgroundColor: 'rgba(49,130,206,0.3)', borderColor: '#3182ce' }] 
        }, 
        options: { responsive: true, maintainAspectRatio: false, scales: { r: { beginAtZero: true, max: 5 } } } 
    }); 
}

function drawBarChart(s) { 
    const ctx = document.getElementById('barChart').getContext('2d'); 
    if (barChart) barChart.destroy(); 
    barChart = new Chart(ctx, { 
        type: 'bar', 
        data: { 
            labels: ['سیل','زلزله','رانش زمین','فرونشست زمین','صاعقه','طوفان','دما','هوانوردی'], 
            datasets: [{ label: 'امتیاز', data: s, backgroundColor: s.map(v=>v>=4?'#e53e3e':v>=3?'#dd6b20':'#38a169') }] 
        }, 
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 5 } } } 
    }); 
}

function drawPrecipChart(d) { 
    const ctx = document.getElementById('precipChart').getContext('2d'); 
    if (precipChart) precipChart.destroy(); 
    precipChart = new Chart(ctx, { type: 'bar', data: { labels: MONTH_NAMES_FA, datasets: [{ label: 'mm', data: d, backgroundColor: '#3182ce' }] }, options: { responsive: true, maintainAspectRatio: false } }); 
}

function drawWindChart(d) { 
    const ctx = document.getElementById('windChart').getContext('2d'); 
    if (windChart) windChart.destroy(); 
    windChart = new Chart(ctx, { type: 'line', data: { labels: MONTH_NAMES_FA, datasets: [{ label: 'km/h', data: d, borderColor: '#38a169', tension: 0.3 }] }, options: { responsive: true, maintainAspectRatio: false } }); 
}

function drawTempChart(d) { 
    const ctx = document.getElementById('tempChart').getContext('2d'); 
    if (tempChart) tempChart.destroy(); 
    tempChart = new Chart(ctx, { type: 'line', data: { labels: MONTH_NAMES_FA, datasets: [{ label: 'C°', data: d, borderColor: '#dd6b20', tension: 0.3 }] }, options: { responsive: true, maintainAspectRatio: false } }); 
}

// ============================================================
// دستیار بیمه‌گر
// ============================================================
function generateInsuranceAssistant(e, s, l, f, land, av, climate) {
    const c = document.getElementById('insuranceContent'); 
    let html = ''; 
    let has = false;
    
    const cardStyle = `background:#ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); padding:15px; margin-bottom:15px;`;
    
    if (e > 2.5) { 
        has = true; 
        html += `<div style="${cardStyle} border-right:4px solid #e53e3e;"><h4>🌍 زلزله (امتیاز: ${e.toFixed(1)})</h4><p><strong>مدارک:</strong> گزارش ژئوتکنیک، نقشه سازه، سوابق ترک.</p><p><strong>توصیه:</strong> دامنه پوشش زلزله و فرانشیز درج شود.</p></div>`; 
    }
    
    if (s > 2.5) { 
        has = true; 
        html += `<div style="${cardStyle} border-right:4px solid #dd6b20;"><h4>📉 فرونشست زمین (امتیاز: ${s.toFixed(1)})</h4><p><strong>مدارک:</strong> پایش تراز، وضعیت خطوط مدفون.</p><p><strong>توصیه:</strong> پوشش فرونشست جدا از زلزله روشن شود.</p></div>`; 
    }
    
    if (l > 2.5) { 
        has = true; 
        html += `<div style="${cardStyle} border-right:4px solid #38a169;"><h4>⚡ صاعقه (امتیاز: ${l.toFixed(1)})</h4><p><strong>مدارک:</strong> طرح حفاظت صاعقه، لیست تجهیزات حساس.</p><p><strong>توصیه:</strong> پوشش اضافه‌ولتاژ جداگانه روشن شود.</p></div>`; 
    }
    
    if (f > 2.5 && climate) { 
        has = true; 
        html += `<div style="${cardStyle} border-right:4px solid #3182ce;"><h4>🌊 سیل (امتیاز: ${f.toFixed(1)})</h4><p><strong>وضعیت:</strong> میانگین بارش سالانه ${climate.precip.annualAvg.toFixed(0)} mm.</p><p><strong>توصیه:</strong> بازدید از زهکشی و اخذ مدارک سیلاب‌های گذشته.</p></div>`; 
    }
    
    if (land > 2.5) { 
        has = true; 
        html += `<div style="${cardStyle} border-right:4px solid #805ad5;"><h4>⛰️ رانش زمین (امتیاز: ${land.toFixed(1)})</h4><p><strong>توصیه:</strong> بررسی پایداری شیب و زهکشی دامنه‌ها.</p></div>`; 
    }

    if (av > 2.5) { 
        has = true; 
        html += `<div style="${cardStyle} border-right:4px solid #319795;"><h4>✈️ هوانوردی (امتیاز: ${av.toFixed(1)})</h4><p><strong>توصیه:</strong> بررسی حریم فرودگاه، موانع پروازی، و خطر پرنده یا پهپاد.</p></div>`; 
    }
    
    if (!has) html = '<p style="color:#38a169; text-align:center;">✅ هیچ مخاطره‌ای با امتیاز بالاتر از ۲.۵ یافت نشد.</p>';
    c.innerHTML = html; 
    document.getElementById('insuranceAssistant').style.display = 'block';
}
// ============================================================
// خروجی PDF
// ============================================================
async function downloadPDF() {
    const resultEl = document.getElementById('result');
    const btn = document.getElementById('pdfBtn');
    
    if (!resultEl.classList.contains('show')) return alert('ابتدا تحلیل را انجام دهید.');
    
    const originalBtnStyle = btn.style.display;
    btn.style.display = 'none';
    btn.disabled = true;

    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const margin = 15;
        const contentWidth = pdfWidth - (margin * 2);
        let currentY = 20;

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(18);
        pdf.text("Insurance Risk Assessment Report", pdfWidth / 2, 15, { align: "center" });
        pdf.setFontSize(10);
        pdf.setFont("helvetica", "normal");
        pdf.text("Generated by Multi-Hazard Risk Assessment System", pdfWidth / 2, 22, { align: "center" });
        currentY = 30;

        const addElementToPDF = async (element, title = null) => {
            if (!element || element.offsetHeight === 0) return;
            const canvas = await html2canvas(element, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
            const imgData = canvas.toDataURL('image/jpeg', 0.9);
            const imgWidth = contentWidth;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;

            if (currentY + imgHeight + 10 > pdfHeight - margin) {
                pdf.addPage();
                currentY = margin;
            }
            if (title) {
                pdf.setFont("helvetica", "bold");
                pdf.setFontSize(12);
                pdf.text(title, margin, currentY);
                currentY += 6;
            }
            pdf.addImage(imgData, 'JPEG', margin, currentY, imgWidth, imgHeight);
            currentY += imgHeight + 10;
        };

        await addElementToPDF(document.getElementById('hazardCards'), "Risk Score Summary");
        await addElementToPDF(document.getElementById('radarChart').closest('.chart-section'), "Radar Chart");
        await addElementToPDF(document.getElementById('barChart').closest('.chart-section'), "Comparison Chart");
        await addElementToPDF(document.getElementById('precipChart').closest('.chart-section'), "Monthly Precipitation");
        await addElementToPDF(document.getElementById('windChart').closest('.chart-section'), "Monthly Wind Speed");
        await addElementToPDF(document.getElementById('tempChart').closest('.chart-section'), "Monthly Temperature");
        await addElementToPDF(document.getElementById('paramDetails'), "Analysis Details");
        await addElementToPDF(document.getElementById('insuranceAssistant'), "Insurance Assistant Recommendations");

        pdf.save('Insurance-Risk-Report.pdf');

    } catch (error) {
        console.error('PDF Error:', error);
        alert('خطا در تولید PDF. لطفاً دوباره تلاش کنید.');
    } finally {
        btn.style.display = originalBtnStyle;
        btn.disabled = false;
    }
}

// ============================================================
// راه‌اندازی اولیه
// ============================================================
function calculatePremium() {
    const base = parseFloat(document.getElementById('baseRate').value) || 0;
    const basis = document.getElementById('rateBasis').value;
    const resultDiv = document.getElementById('premiumResult');
    const historyList = document.getElementById('historyList');
    
    let score = currentScores[basis];
    
    if (!score) {
        resultDiv.innerHTML = '<span style="color: #e53e3e;">⚠️ ابتدا یک نقطه را تحلیل کنید.</span>';
        return;
    }

    let multiplier = 1;
    if (score > 4) multiplier = 2.0;
    else if (score > 3) multiplier = 1.5;
    else if (score > 2) multiplier = 1.2;

    const finalRate = base * multiplier;
    let color = multiplier >= 1.5 ? '#e53e3e' : (multiplier >= 1.2 ? '#dd6b20' : '#38a169');
    
    const basisNames = { 
        overall: 'ریسک کلی', flood: 'سیل', earthquake: 'زلزله', 
        landslide: 'رانش زمین', subsidence: 'فرونشست زمین', 
        lightning: 'صاعقه', storm: 'طوفان', temperature: 'دما', aviation: 'هوانوردی' 
    };
    
    // ۱. نمایش نتیجه در فیلد اصلی
           resultDiv.innerHTML = `
        <div style="padding: 15px; background: #ebf8ff; border-radius: 5px; border-right: 4px solid ${color}; margin-top: 10px;">
            <div style="margin-bottom: 5px; color: #4a5568;">مبنای محاسبه: <strong>${basisNames[basis]}</strong> (امتیاز ریسک: ${score.toFixed(1)})</div>
            <div style="margin-bottom: 5px; color: #2d3748;">نرخ پایه (Base Rate): <strong>${base.toFixed(5)}</strong></div>
            <div style="margin-bottom: 5px; color: ${color};">ضریب تعدیل ریسک (Risk Multiplier): <strong>${multiplier}</strong></div>
            <div style="font-size: 18px; color: #2d3748; margin-top: 10px; border-top: 1px dashed #cbd5e0; padding-top: 10px;">نرخ نهایی تعدیل‌شده (Final Rate): <strong>${finalRate.toFixed(5)}</strong></div>
        </div>
    `;

    // ۲. ذخیره در تاریخچه
    const li = document.createElement('li');
    li.style.cssText = 'padding: 8px; border-bottom: 1px solid #e2e8f0; color: #2d3748;';
    li.innerHTML = `<strong>${basisNames[basis]}</strong>: نرخ ${finalRate.toFixed(5)} (ضریب تعدیل: ${multiplier})`;
    historyList.prepend(li); // اضافه کردن به بالای لیست

    // ۳. صفر کردن فیلد نرخ پایه برای محاسبه بعدی
    document.getElementById('baseRate').value = '';
}
function drawMarkerOnImage(imageId, lat, lon) {
    const imgContainer = document.getElementById(imageId);
    if (!imgContainer) return;
    
    const oldMarker = imgContainer.querySelector('.map-marker');
    if (oldMarker) oldMarker.remove();

    // 🌟 تنظیمات کالیبراسیون اختصاصی برای نقشه زلزله (EMME)
    // مرزهای جغرافیایی دقیق این عکس:
    const minLon = 20, maxLon = 80; 
    const minLat = 20, maxLat = 45;

    // درصد حاشیه‌های سفید (برای جبران خطا)
    const marginLeft = 0.03;   // ۳٪ حاشیه از چپ
    const marginRight = 0.03;  // ۳٪ حاشیه از راست
    const marginTop = 0.02;    // ۲٪ حاشیه از بالا
    const marginBottom = 0.17; // ۱۵٪ حاشیه از پایین (نوار EMME)

    // محاسبه درصد موقعیت نقطه در فضای خالص نقشه (بدون حاشیه)
    let xRatio = (lon - minLon) / (maxLon - minLon);
    let yRatio = (maxLat - lat) / (maxLat - minLat);

    // نگاشت به درصد کل عکس (با احتساب حاشیه‌ها)
    let leftPercent = (marginLeft + (xRatio * (1 - marginLeft - marginRight))) * 100;
    let topPercent = (marginTop + (yRatio * (1 - marginTop - marginBottom))) * 100;
    topPercent = topPercent + 2.5; // 🌟 اضافه کردن ۲.۵ درصد به پایین برای تنظیم دقیق

    if (leftPercent < 0 || leftPercent > 100 || topPercent < 0 || topPercent > 100) return;

    // ساخت دایره قرمز
    const marker = document.createElement('div');
    marker.className = 'map-marker';
    marker.style.position = 'absolute';
    marker.style.left = `${leftPercent}%`;
    marker.style.top = `${topPercent}%`;
    marker.style.width = '14px';
    marker.style.height = '14px';
    marker.style.backgroundColor = '#e53e3e';
    marker.style.borderRadius = '50%';
    marker.style.border = '2px solid #ffffff';
    marker.style.boxShadow = '0 0 0 4px rgba(160, 174, 192, 0.6), 0 0 10px rgba(0,0,0,0.8)';
    marker.style.transform = 'translate(-50%, -50%)';
    marker.style.animation = 'pulse 1.5s infinite';
    marker.style.zIndex = '10';
    
    imgContainer.style.position = 'relative';
    imgContainer.style.display = 'inline-block'; 
    
    imgContainer.appendChild(marker);
}
function showMapWithOverlay(lat, lon) {
    if (window.overlayMap) {
        window.overlayMap.remove();
    }
    window.overlayMap = L.map('eqMapOverlay').setView([lat, lon], 5);

    // 🌟 مرزهای دقیق نقشه EMME (از KML قبلی)
    const imageBounds = [[16.9104632, 15.7817301], [47.8917733, 82.1054825]]; 
    L.imageOverlay('earthquake-map.png', imageBounds).addTo(window.overlayMap);

    const redIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style='background-color: red; width: 15px; height: 15px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 0 4px rgba(160, 174, 192, 0.6), 0 0 10px rgba(0,0,0,0.8); animation: pulse 1.5s infinite;'></div>`,
        iconSize: [15, 15],
        iconAnchor: [7.5, 7.5]
    });

    L.marker([lat, lon], { icon: redIcon }).addTo(window.overlayMap);
    window.overlayMap.setView([lat, lon], 6);
}

function showPgaMapWithOverlay(lat, lon) {
    if (window.pgaOverlayMap) {
        window.pgaOverlayMap.remove();
    }

        // 🌟 تنظیمات اولیه برای نمایش کل ایران
    const defaultCenter = [32.4279, 53.6880]; // مختصات مرکز ایران
    const defaultZoom = 5; // زوم مناسب برای دیدن کل کشور
    
    window.pgaOverlayMap = L.map('pgaMapOverlay').setView(defaultCenter, defaultZoom);

    // 🌟 مرزهای دقیق نقشه PGA (از KML جدید)
    const pgaBounds = [[24.3247255, 43.2152624], [41.1400301, 64.2886042]]; 
    L.imageOverlay('pga-map.png', pgaBounds).addTo(window.pgaOverlayMap);

    const redIcon = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style='background-color: red; width: 15px; height: 15px; border-radius: 50%; border: 2px solid white; box-shadow: 0 0 0 4px rgba(160, 174, 192, 0.6), 0 0 10px rgba(0,0,0,0.8); animation: pulse 1.5s infinite;'></div>`,
        iconSize: [15, 15],
        iconAnchor: [7.5, 7.5]
    });

    L.marker([lat, lon], { icon: redIcon }).addTo(window.pgaOverlayMap);
        // در نهایت، مارکر را اضافه کرده و نقشه را به نقطه انتخابی منتقل کن
    L.marker([lat, lon], { icon: redIcon }).addTo(window.pgaOverlayMap);
    
    // 🌟 انتقال به نقطه انتخابی (با زوم مناسب)
    window.pgaOverlayMap.setView([lat, lon], 6);
}
window.addEventListener('DOMContentLoaded', function() {
    loadToken();
    initMap();
    setupSmartSearch();
    console.log('🚀 سامانه جامع بیمه‌ای راه‌اندازی شد');
});
