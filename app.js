/* ============================================================
   FYSC — app.js  |  Per-second simulation + thumbnails + engagement
   ============================================================ */

'use strict';

// ══════════════════════════════════════════
//  CONSTANTS
// ══════════════════════════════════════════
const TOTAL_SECONDS     = Math.round(5 * 365.25 * 24 * 3600);  // 157,766,400
const SECONDS_PER_MONTH = TOTAL_SECONDS / 60;

const COLOR_PRESETS = [
  '#7c3aed','#f72585','#06d6e2','#ff7043',
  '#00c853','#ffd600','#00bcd4','#ff4081',
  '#69f0ae','#ff6d00','#e040fb','#40c4ff',
];

// ══════════════════════════════════════════
//  APP STATE
// ══════════════════════════════════════════
const state = { channels: [], videos: [] };

// ══════════════════════════════════════════
//  PLAYBACK ENGINE
// ══════════════════════════════════════════
let SIM_START = new Date();

// ══════════════════════════════════════════
//  SIM START DATE  (persisted to localStorage)
// ══════════════════════════════════════════
function loadSimStart() {
  const saved = localStorage.getItem('fysc_sim_start');
  if (saved) {
    const d = new Date(saved + 'T00:00:00');
    if (!isNaN(d.getTime())) SIM_START = d;
  }
  // Sync picker
  const picker = document.getElementById('sim-start-date');
  if (picker) picker.value = SIM_START.toISOString().slice(0, 10);
}

function saveSimStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) { showToast('⚠️ Invalid date'); return; }
  SIM_START = d;
  localStorage.setItem('fysc_sim_start', dateStr);
  pausePlayback();
  playback.currentSecond = 0;
  // Invalidate thumbnail cache (upload-offset labels may change relative display)
  Object.keys(thumbnailCache).forEach(k => delete thumbnailCache[k]);
  renderAll();
  if (state.videos.length > 0) startPlayback();
  showToast(`📅 Simulation starts ${d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })}`);
}

const playback = {
  currentSecond: 0,
  isPlaying:     false,
  speed:         3600, // Default: 1 Hour
  lastRealMs:    null,
  rafId:         null,
  lastHeavyMs:   0,
  updateIntervalMs: 4000, // Default: 4 Seconds
  compareIds: [],
};

function togglePlayback() {
  if (state.videos.length === 0) { showToast('⚠️ Add a video first!'); return; }
  if (playback.currentSecond >= TOTAL_SECONDS && !playback.isPlaying) playback.currentSecond = 0;
  playback.isPlaying ? pausePlayback() : startPlayback();
}
function startPlayback() {
  playback.isPlaying = true;
  playback.lastHeavyMs = performance.now() - playback.updateIntervalMs; // Force immediate simulation tick on play
  updatePlayBtn();
  playback.rafId = requestAnimationFrame(tick);
}
function pausePlayback() {
  playback.isPlaying = false;
  if (playback.rafId) { cancelAnimationFrame(playback.rafId); playback.rafId = null; }
  updatePlayBtn();
}
function resetPlayback() {
  pausePlayback(); playback.currentSecond = 0;
  if (compareTotalsChart) { compareTotalsChart.destroy(); compareTotalsChart = null; }
  if (compareGainsChart) { compareGainsChart.destroy(); compareGainsChart = null; }
  doFrame(performance.now());
}
function updatePlayBtn() {
  const btn = document.getElementById('btn-play-pause');
  if (btn) btn.textContent = playback.isPlaying ? '⏸ Pause' : '▶ Play';
}

function tick(realNow) {
  if (!playback.isPlaying) return;
  
  if (realNow - playback.lastHeavyMs >= playback.updateIntervalMs) {
    playback.currentSecond += playback.speed;
    playback.lastHeavyMs = realNow;
    
    if (playback.currentSecond >= TOTAL_SECONDS) {
      playback.currentSecond = TOTAL_SECONDS;
      doFrame(realNow);
      pausePlayback();
      showToast('🎉 5-year simulation complete!');
      return;
    }
    doFrame(realNow);
  }
  
  playback.rafId = requestAnimationFrame(tick);
}

function doFrame(realNow) {
  updatePlaybackUI();
  updateCounters();
  updateLiveChart();
  updateLiveVideoCards();
  updateComparison();
}

function updatePlaybackUI() {
  const t       = playback.currentSecond;
  const simDate = new Date(SIM_START.getTime() + t * 1000);
  const label   = simDate.toLocaleString('en-US', { 
    year:'numeric', month:'short', day:'numeric', 
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12: true 
  });
  const lbl  = document.getElementById('pb-time-label');
  const fill = document.getElementById('pb-progress-fill');
  const scrb = document.getElementById('pb-scrubber');
  if (lbl)  lbl.textContent  = label;
  if (fill) fill.style.width = ((t / TOTAL_SECONDS) * 100).toFixed(4) + '%';
  if (scrb && document.activeElement !== scrb) scrb.value = Math.round(t);
}

// ══════════════════════════════════════════
//  THUMBNAIL GENERATION
// ══════════════════════════════════════════
const thumbnailCache = {};

function hexToRgb(hex) {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
}

function getTitleEmoji(title, niche) {
  const t = title.toLowerCase();
  if (/(minecraft|terraria|roblox|fortnite|among us|game|gaming|fps|mmo|playthrough)/.test(t)) return '🎮';
  if (/(code|coding|programm|software|app|react|python|javascript|pc build|setup|dev)/.test(t)) return '💻';
  if (/(cook|recipe|food|eat|meal|dish|kitchen|chef|bake|restaurant)/.test(t)) return '🍳';
  if (/(music|song|beat|rap|sing|vocal|album|track|remix)/.test(t)) return '🎵';
  if (/(world record|million|billion|viral|trending|most)/.test(t)) return '🏆';
  if (/(vs|battle|challenge|fight|war|face off|versus)/.test(t)) return '⚔️';
  if (/(secret|hack|trick|tip|cheat|exploit|hidden)/.test(t)) return '🤫';
  if (/(24 hour|hours straight|days|overnight|hour)/.test(t)) return '⏰';
  if (/(vlog|day in|my life|week in|morning)/.test(t)) return '📹';
  if (/(gym|workout|exercise|fitness|muscle|weight|diet)/.test(t)) return '💪';
  if (/(review|unbox|unboxing|test|try|first look|hands on)/.test(t)) return '📦';
  if (/(travel|trip|visit|tour|vacation|explore)/.test(t)) return '✈️';
  if (/(money|invest|rich|crypto|stock|business|earn)/.test(t)) return '💰';
  if (/(scary|horror|ghost|haunted|creep)/.test(t)) return '👻';
  if (/(funny|comedy|fail|prank|laugh|try not)/.test(t)) return '😂';
  const nicheEmojis = { gaming:'🎮', tech:'💻', vlog:'📹', education:'📚', music:'🎵', comedy:'😂', fitness:'💪', cooking:'🍳' };
  return nicheEmojis[niche] ?? '▶️';
}

function generateThumbnail(video, channel) {
  const W = 320, H = 180;
  const el = document.createElement('canvas');
  el.width = W; el.height = H;
  const ctx = el.getContext('2d');
  const { r, g, b } = hexToRgb(channel.color);

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, `rgba(${r},${g},${b},0.95)`);
  bg.addColorStop(0.55, `rgba(${Math.round(r*.35)},${Math.round(g*.35)},${Math.round(b*.35)},0.9)`);
  bg.addColorStop(1, 'rgba(8,10,20,0.98)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Subtle grid texture
  ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 32) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 32) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  // Radial glow
  const glow = ctx.createRadialGradient(W*.38, H*.42, 8, W*.38, H*.42, W*.52);
  glow.addColorStop(0, `rgba(${r},${g},${b},0.4)`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

  // Big emoji
  const emoji = getTitleEmoji(video.title, channel.niche);
  ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 22;
  ctx.font = '78px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(emoji, W / 2, H * 0.46);
  ctx.shadowBlur = 0;

  // Bottom scrim
  const scrim = ctx.createLinearGradient(0, H - 50, 0, H);
  scrim.addColorStop(0, 'rgba(0,0,0,0)');
  scrim.addColorStop(0.4, 'rgba(0,0,0,0.72)');
  scrim.addColorStop(1,   'rgba(0,0,0,0.93)');
  ctx.fillStyle = scrim; ctx.fillRect(0, H - 50, W, 50);

  // Title text
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11.5px "Inter",Arial,sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;
  const short = video.title.length > 40 ? video.title.slice(0, 37) + '…' : video.title;
  ctx.fillText(short, 10, H - 14);
  ctx.shadowBlur = 0;

  // Channel color top stripe
  ctx.fillStyle = channel.color; ctx.fillRect(0, 0, W, 4);

  // Type badge
  const badges = { short:'SHORT', viral:'VIRAL', long:'LONG' };
  const badgeText = badges[video.type];
  if (badgeText) {
    const bColor = video.type === 'viral' ? '#f72585' : video.type === 'short' ? '#00c853' : '#ff7043';
    ctx.font = 'bold 9px "Inter",Arial,sans-serif';
    const bw = ctx.measureText(badgeText).width + 14;
    ctx.fillStyle = bColor;
    roundRect(ctx, W - bw - 8, 10, bw, 18, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, W - (bw / 2) - 8, 19);
  }

  return el.toDataURL('image/jpeg', 0.88);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function getOrCreateThumbnail(video, channel) {
  if (!thumbnailCache[video.id]) {
    thumbnailCache[video.id] = generateThumbnail(video, channel);
  }
  return thumbnailCache[video.id];
}

// ══════════════════════════════════════════
//  ENGAGEMENT METRICS
// ══════════════════════════════════════════
function engagement(video, views) {
  const rng         = seededRng(video.id + '_eng');
  const likeRate    = 0.028 + rng() * 0.04   + (video.quality   - 1) / 9 * 0.025;
  const dislikeRate = 0.003 + rng() * 0.008  + (video.clickbait - 1) / 9 * 0.018;
  const commentRate = 0.003 + rng() * 0.014  + (video.quality   - 1) / 9 * 0.008;
  const likes    = Math.round(views * likeRate);
  const dislikes = Math.round(views * dislikeRate);
  const comments = Math.round(views * commentRate);
  const ratio    = likes / Math.max(likes + dislikes, 1);
  return { likes, dislikes, comments, ratio };
}

// ══════════════════════════════════════════
//  PER-SECOND INTERPOLATION
//  No sine ripple — cumulative counts only go up.
//  Respects upload date.
// ══════════════════════════════════════════
function valueAtSecond(video, t) {
  if (!video.projection) return { views: 0, subs: 0 };
  const uploadDate   = new Date(video.date + 'T00:00:00');
  const uploadOffset = Math.max(0, (uploadDate.getTime() - SIM_START.getTime()) / 1000);
  if (t < uploadOffset) return { views: 0, subs: 0 };
  const effectiveT = Math.min(t - uploadOffset, TOTAL_SECONDS);
  const { viewsByMonth, subsByMonth } = video.projection;
  const monthF = effectiveT / SECONDS_PER_MONTH;
  const m0 = Math.min(Math.floor(monthF), 59);
  const m1 = Math.min(m0 + 1, 59);
  
  // Cosine smooth interpolation for base growth
  const f  = monthF - m0;
  const fSmooth = (1 - Math.cos(f * Math.PI)) / 2;
  
  const baseViews = Math.max(0, Math.round(viewsByMonth[m0] + (viewsByMonth[m1] - viewsByMonth[m0]) * fSmooth));
  const baseSubs  = Math.max(0, Math.round(subsByMonth[m0]  + (subsByMonth[m1]  - subsByMonth[m0])  * fSmooth));

  // Diurnal Wave (24h Activity Cycle) - STABLE ADDITIVE RATE MODULATION
  // We apply the wave to the GROWTH RATE, not the total count.
  // This ensures that at every 24-hour interval, the modulation cancels out to 0 (perfect smoothness).
  
  const safeT = Math.max(0.1, t); // Prevent div by 0 and NaN
  const tHours = safeT / 3600;

  const A = 0.35; // Fluctuating Amplitude (35% change in rate)
  const W = (2 * Math.PI) / 24; // Angular frequency (24h period)
  
  // Phase shift so peak is at hour 14 (2 PM)
  const startHour = (SIM_START instanceof Date && !isNaN(SIM_START)) ? SIM_START.getHours() + SIM_START.getMinutes()/60 : 0;
  const phi = (startHour - 8) * W; 

  const fluctuationIntegral = (A / W) * (Math.cos(phi) - Math.cos(W * tHours + phi));
  
  // Average Growth Rate (subs per hour)
  const rateViews = baseViews / tHours;
  const rateSubs  = baseSubs / tHours;
  
  const finalViews = baseViews + (rateViews * fluctuationIntegral);
  const finalSubs  = baseSubs  + (rateSubs  * fluctuationIntegral);

  return {
    views: Math.round(Number.isFinite(finalViews) ? Math.max(0, finalViews) : baseViews),
    subs:  Math.round(Number.isFinite(finalSubs)  ? Math.max(0, finalSubs)  : baseSubs),
  };
}

// ══════════════════════════════════════════
//  LIVE COUNTERS  (every RAF frame)
// ══════════════════════════════════════════
function updateCounters() {
  const t = playback.currentSecond;
  let totalSubs = 0, totalViews = 0;
  state.channels.forEach(ch => { totalSubs += ch.baseSubs; });
  state.videos.forEach(v => {
    const val = valueAtSecond(v, t);
    totalViews += val.views; totalSubs += val.subs;
  });
  const se = document.getElementById('global-subs');
  const ve = document.getElementById('global-views');
  if (se) { 
    if (!se.odInstance) { se.innerHTML = ''; se.odInstance = new Odometer({ el: se, value: Math.round(totalSubs) }); }
    se.odInstance.update(Math.round(totalSubs)); 
  }
  if (ve) { 
    if (!ve.odInstance) { ve.innerHTML = ''; ve.odInstance = new Odometer({ el: ve, value: Math.round(totalViews) }); }
    ve.odInstance.update(Math.round(totalViews)); 
  }
  // Sidebar channel subs — update text AND re-sort via CSS order
  const chSubs = state.channels.map(ch => {
    let subs = ch.baseSubs;
    state.videos.filter(v => v.channelId === ch.id).forEach(v => { subs += valueAtSecond(v, t).subs; });
    return { ch, subs };
  }).sort((a, b) => b.subs - a.subs);

  // Apply CSS order so DOM re-sorts without innerHTML rebuild
  const list = document.getElementById('channels-list');
  if (list) list.style.display = 'flex', list.style.flexDirection = 'column';
  chSubs.forEach(({ ch, subs }, rank) => {
    const card = document.getElementById(`ch-card-${ch.id}`);
    if (!card) return;
    card.style.order = rank;
    const meta = card.querySelector('.channel-meta');
    if (meta) meta.textContent = `${ch.niche} · ${fmt(Math.round(subs))} subs`;
    
    const vsBtn = card.querySelector('.btn-compare');
    if (vsBtn) {
      if (playback.compareIds.includes(ch.id)) vsBtn.classList.add('selected');
      else vsBtn.classList.remove('selected');
    }
  });
}

// ══════════════════════════════════════════
//  SEEDED RNG (Mulberry32)
// ══════════════════════════════════════════
function seededRng(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  let s = h >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ══════════════════════════════════════════
//  ALGORITHM  (60 monthly anchors)
// ══════════════════════════════════════════
function projectGrowth(video, channel) {
  const viewsByMonth = [], subsByMonth = [];
  const quality = video.quality / 10, clickbait = video.clickbait / 10;
  const nicheMulti = { gaming:1.4,tech:1.2,vlog:1.0,education:0.9,music:1.3,comedy:1.5,fitness:1.1,cooking:0.95 }[channel.niche] ?? 1.0;
  const typeConfig = {
    short:    { capViews:12_000_000, capSubs:  5_000, virality:1.6, peakMonth:1, decay:0.85 },
    standard: { capViews: 5_000_000, capSubs: 12_000, virality:1.0, peakMonth:3, decay:0.97 },
    long:     { capViews: 2_000_000, capSubs: 20_000, virality:0.8, peakMonth:4, decay:0.98 },
    viral:    { capViews:40_000_000, capSubs: 50_000, virality:3.0, peakMonth:2, decay:0.92 },
  }[video.type] ?? { capViews:5_000_000, capSubs:12_000, virality:1.0, peakMonth:3, decay:0.97 };
  const subBoost = Math.log10(Math.max(channel.baseSubs, 10) + 1) / 7;
  const virality = Math.min(1, (quality*.55 + clickbait*.35 + subBoost*.1) * typeConfig.virality * nicheMulti);
  const rng = seededRng(video.id);
  let cumViews = 0, cumSubs = 0;
  for (let m = 0; m < 60; m++) {
    const ramp  = Math.min(1, m / typeConfig.peakMonth);
    const decay = Math.pow(typeConfig.decay, Math.max(0, m - typeConfig.peakMonth));
    const noise = 0.85 + rng() * 0.3;
    const bump  = rng() < 0.05 ? (1.5 + rng()) : 1;
    const mv = Math.round(virality * typeConfig.capViews * ramp * decay * noise * bump);
    const ms = Math.round((mv / typeConfig.capViews) * typeConfig.capSubs * noise * bump);
    cumViews += mv; cumSubs += ms;
    viewsByMonth.push(cumViews); subsByMonth.push(cumSubs);
  }
  return { viewsByMonth, subsByMonth };
}

// ══════════════════════════════════════════
//  STORAGE
// ══════════════════════════════════════════
function saveState() {
  localStorage.setItem('fysc_state', JSON.stringify({
    channels: state.channels,
    videos:   state.videos.map(v => ({ ...v, projection: undefined })),
  }));
}
function loadState() {
  try {
    const raw = localStorage.getItem('fysc_state');
    if (!raw) return;
    const saved = JSON.parse(raw);
    state.channels = saved.channels || [];
    state.videos = (saved.videos || []).map(v => {
      const ch = state.channels.find(c => c.id === v.channelId);
      if (ch) v.projection = projectGrowth(v, ch);
      return v;
    });
  } catch (e) { console.warn('Failed to load state', e); }
}

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function fmt(n) {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000)     return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)         return (n / 1_000).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
}
function typeLabel(t) {
  return { short:'🩳 Short', standard:'📹 Standard', long:'📺 Long Form', viral:'🚀 Viral' }[t] ?? t;
}
function milestoneTime(data, threshold) {
  const idx = data.findIndex(v => v >= threshold);
  if (idx < 0) return null;
  const yrs = Math.floor(idx / 12), mos = idx % 12;
  if (yrs === 0) return `${mos}mo`; if (mos === 0) return `${yrs}yr`;
  return `${yrs}yr ${mos}mo`;
}
let toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, 2800);
}

// ══════════════════════════════════════════
//  CSV EXPORT
// ══════════════════════════════════════════
function downloadCSV() {
  if (state.videos.length === 0 && state.channels.length === 0) {
    showToast('⚠️ Nothing to download!'); return;
  }
  
  const headers = ['Day', 'Date', 'Global Views', 'Global Subs'];
  state.channels.forEach(ch => {
    headers.push(`"${ch.name} Views"`);
    headers.push(`"${ch.name} Subs"`);
  });

  const rows = [];
  const totalDays = Math.ceil(TOTAL_SECONDS / 86400);

  for (let d = 0; d <= totalDays; d++) {
    const t = Math.min(d * 86400, TOTAL_SECONDS);
    const dateStr = new Date(SIM_START.getTime() + t * 1000).toISOString().slice(0, 10);
    
    let globalViews = 0, globalSubs = 0;
    const chData = {};
    
    state.channels.forEach(ch => {
       chData[ch.id] = { views: 0, subs: ch.baseSubs };
       globalSubs += ch.baseSubs;
    });
    
    state.videos.forEach(v => {
      const val = valueAtSecond(v, t);
      globalViews += val.views;
      globalSubs += val.subs;
      if (chData[v.channelId]) {
         chData[v.channelId].views += val.views;
         chData[v.channelId].subs += val.subs;
      }
    });
    
    const row = [d, dateStr, globalViews, globalSubs];
    state.channels.forEach(ch => {
       row.push(chData[ch.id].views);
       row.push(chData[ch.id].subs);
    });
    
    rows.push(row);
  }
  
  const csvContent = "data:text/csv;charset=utf-8," 
    + headers.join(',') + "\n" 
    + rows.map(r => r.join(',')).join("\n");
    
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `youtube_growth_daily_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast('📥 Downloaded Daily CSV!');
}

// ══════════════════════════════════════════
//  MILESTONES
// ══════════════════════════════════════════
function updateMilestones() {
  const aggSubs = new Array(60).fill(0);
  const filterCh = document.getElementById('filter-channel').value;
  state.channels.forEach(ch => {
    if (filterCh !== 'all' && ch.id !== filterCh) return;
    for (let i = 0; i < 60; i++) aggSubs[i] += ch.baseSubs;
  });
  state.videos.forEach(v => {
    if (!v.projection) return;
    const ch = state.channels.find(c => c.id === v.channelId);
    if (!ch || (filterCh !== 'all' && v.channelId !== filterCh)) return;
    v.projection.subsByMonth.forEach((s, i) => { aggSubs[i] += s; });
  });
  const mBar = document.getElementById('milestones-bar');
  mBar.style.display = state.videos.length > 0 ? 'flex' : 'none';
  document.getElementById('milestone-100k').textContent = milestoneTime(aggSubs, 100_000)    ?? 'Beyond 5yr';
  document.getElementById('milestone-1m').textContent   = milestoneTime(aggSubs, 1_000_000)  ?? 'Beyond 5yr';
  document.getElementById('milestone-10m').textContent  = milestoneTime(aggSubs, 10_000_000) ?? 'Beyond 5yr';
}

// ══════════════════════════════════════════
//  CHART  — Horizontal, sorted top→bottom, with datalabels
// ══════════════════════════════════════════
function applyShade(hex, videoId, isBg) {
  const rng = seededRng(videoId);
  const { r, g, b } = hexToRgb(hex);
  const shade = -35 + Math.floor(rng() * 70); 
  const r2 = Math.max(0, Math.min(255, r + shade));
  const g2 = Math.max(0, Math.min(255, g + shade));
  const b2 = Math.max(0, Math.min(255, b + shade));
  return isBg ? `rgba(${r2},${g2},${b2}, 0.85)` : `rgb(${r2},${g2},${b2})`;
}

let chartInstance = null;

function getRelevantVideos() {
  const filterCh = document.getElementById('filter-channel').value;
  return state.videos.filter(v => {
    if (!state.channels.find(c => c.id === v.channelId)) return false;
    if (filterCh !== 'all' && v.channelId !== filterCh) return false;
    return true;
  });
}

function getSortedVideos(videos, metric, t) {
  return [...videos].sort((a, b) => {
    const av = valueAtSecond(a, t), bv = valueAtSecond(b, t);
    return (metric === 'views' ? bv.views - av.views : bv.subs - av.subs);
  });
}

function renderChart() {
  const canvas = document.getElementById('growth-chart');
  const empty  = document.getElementById('chart-empty');
  const legend = document.getElementById('chart-legend');
  const videos = getRelevantVideos();

  if (videos.length === 0) {
    canvas.style.display = 'none'; empty.style.display = 'flex';
    legend.innerHTML = ''; document.getElementById('milestones-bar').style.display = 'none';
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    return;
  }

  canvas.style.display = 'block'; empty.style.display = 'none';
  const metric  = document.getElementById('filter-metric').value;
  const t       = playback.currentSecond;
  const sorted  = getSortedVideos(videos, metric, t).slice(0, 25);

  // Legend
  const seenCh = new Set();
  legend.innerHTML = sorted.map(v => {
    if (seenCh.has(v.channelId)) return '';
    seenCh.add(v.channelId);
    const ch = state.channels.find(c => c.id === v.channelId);
    return ch ? `<div class="legend-item"><div class="legend-dot" style="background:${ch.color}"></div>${ch.name}</div>` : '';
  }).join('');

  const labels   = sorted.map(v => v.title.length > 26 ? v.title.slice(0, 23) + '…' : v.title);
  const data     = sorted.map(v => { const val = valueAtSecond(v, t); return metric === 'views' ? val.views : val.subs; });
  const bgColors = sorted.map(v => applyShade(state.channels.find(c => c.id === v.channelId)?.color ?? '#7c3aed', v.id, true));
  const brColors = sorted.map(v => applyShade(state.channels.find(c => c.id === v.channelId)?.color ?? '#7c3aed', v.id, false));

  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const container = document.getElementById('chart-container');
  canvas.width  = container.clientWidth - 56;
  canvas.height = Math.max(200, sorted.length * 52 + 40);

  chartInstance = new Chart(canvas, {
    type: 'bar',
    plugins: [ChartDataLabels],
    data: {
      labels,
      datasets: [{
        data, backgroundColor: bgColors, borderColor: brColors,
        borderWidth: 2, borderRadius: 6, borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',   // ← horizontal bars
      responsive: false,
      animation: { duration: 120, easing: 'easeOutQuart' },
      layout: { padding: { right: 96, top: 8, bottom: 8 } },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#181c2b', borderColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1, titleColor: '#f0f2ff', bodyColor: '#8b92b8', padding: 12,
          callbacks: { label: ctx => ` ${fmt(ctx.raw)} ${metric}` },
        },
        datalabels: {
          anchor:    'end',
          align:     'end',
          formatter: (value) => fmt(value),
          color:     '#f0f2ff',
          font:      { family: 'Inter', size: 12, weight: '700' },
          padding:   { left: 6 },
          clip:      false,
        },
      },
      scales: {
        x: {
          min: 0,
          grid:  { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#4b5275', font: { family:'Inter', size:10 }, callback: v => fmt(v) },
        },
        y: {
          grid:  { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#c4c9e2', font: { family:'Inter', size:12, weight:'600' } },
        },
      },
    },
  });
  updateMilestones();
}

function updateLiveChart() {
  if (!chartInstance) { renderChart(); return; }
  const videos = getRelevantVideos();
  if (videos.length === 0) { renderChart(); return; }
  const metric = document.getElementById('filter-metric').value;
  const t      = playback.currentSecond;
  const sorted = getSortedVideos(videos, metric, t).slice(0, 25);

  chartInstance.data.labels = sorted.map(v => v.title.length > 26 ? v.title.slice(0, 23) + '…' : v.title);
  chartInstance.data.datasets[0].data          = sorted.map(v => { const val = valueAtSecond(v, t); return metric === 'views' ? val.views : val.subs; });
  chartInstance.data.datasets[0].backgroundColor = sorted.map(v => applyShade(state.channels.find(c => c.id === v.channelId)?.color ?? '#7c3aed', v.id, true));
  chartInstance.data.datasets[0].borderColor     = sorted.map(v => applyShade(state.channels.find(c => c.id === v.channelId)?.color ?? '#7c3aed', v.id, false));
  chartInstance.update('none');
}

// ══════════════════════════════════════════
//  VIDEO CARDS
// ══════════════════════════════════════════
function renderVideos() {
  const grid = document.getElementById('videos-grid');
  document.getElementById('global-videos').textContent = state.videos.length;
  document.getElementById('videos-count').textContent  =
    `${state.videos.length} video${state.videos.length !== 1 ? 's' : ''}`;

  if (state.videos.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎬</div>
        <h3>No videos yet</h3>
        <p>Add a video to simulate YouTube algorithm growth across your channels!</p>
        <button class="btn btn-primary" onclick="openVideoModal()">+ Add Video</button>
      </div>`; return;
  }

  const t = playback.currentSecond;

  grid.innerHTML = state.videos.map(video => {
    const ch = state.channels.find(c => c.id === video.channelId);
    if (!ch) return '';

    const thumb    = getOrCreateThumbnail(video, ch);
    const val      = valueAtSecond(video, t);
    const eng      = engagement(video, val.views);
    const ratioPct = (eng.ratio * 100).toFixed(1);

    const bars = Array.from({ length: 12 }, (_, i) =>
      valueAtSecond(video, Math.round((i / 11) * t)).views
    );
    const maxBar   = Math.max(...bars, 1);
    const barsHtml = bars.map(v =>
      `<div class="mini-bar" style="height:${((v / maxBar) * 100).toFixed(1)}%;background:${ch.color}"></div>`
    ).join('');

    return `
      <div class="video-card" style="--channel-color:${ch.color}" data-video-id="${video.id}">
        <div class="video-thumbnail-wrap">
          <img class="video-thumbnail" src="${thumb}" alt="${video.title}" loading="lazy" />
          <div class="video-play-overlay">
            <div class="video-play-btn">▶</div>
          </div>
          <div class="video-channel-badge-thumb" style="background:${ch.color}">${ch.name}</div>
        </div>
        <div class="video-card-body">
          <div class="video-title">${video.title}</div>
          <div class="video-stats">
            <div class="video-stat">
              <div class="video-stat-label">📺 Views</div>
              <div class="video-stat-value live-views">${fmt(val.views)}</div>
            </div>
            <div class="video-stat">
              <div class="video-stat-label">🔔 Subs</div>
              <div class="video-stat-value live-subs">${fmt(val.subs)}</div>
            </div>
          </div>
          <div class="video-mini-chart">
            <div class="mini-bar-wrap">${barsHtml}</div>
          </div>
          <div class="video-engagement">
            <div class="eng-item">
              <span class="eng-icon">👍</span>
              <span class="eng-val live-likes">${fmt(eng.likes)}</span>
            </div>
            <div class="eng-sep"></div>
            <div class="eng-item">
              <span class="eng-icon">👎</span>
              <span class="eng-val live-dislikes">${fmt(eng.dislikes)}</span>
            </div>
            <div class="eng-sep"></div>
            <div class="eng-item">
              <span class="eng-icon">💬</span>
              <span class="eng-val live-comments">${fmt(eng.comments)}</span>
            </div>
          </div>
          <div class="like-ratio-track">
            <div class="like-ratio-fill live-like-ratio" style="width:${ratioPct}%"></div>
            <span class="like-ratio-pct live-like-pct">${ratioPct}% liked</span>
          </div>
          <div class="video-card-footer">
            <span class="video-type-badge">${typeLabel(video.type)}</span>
            <span class="video-quality-tags">Q:${video.quality}/10 · CB:${video.clickbait}/10</span>
            <button class="btn btn-danger" data-delete-video="${video.id}">🗑</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function updateLiveVideoCards() {
  const t = playback.currentSecond;
  state.videos.forEach(v => {
    const card = document.querySelector(`[data-video-id="${v.id}"]`);
    if (!card) return;

    const val = valueAtSecond(v, t);
    const eng = engagement(v, val.views);
    const ratioPct = (eng.ratio * 100).toFixed(1);

    const qUpdate = (sel, num) => {
      const el = card.querySelector(sel);
      if (el) el.textContent = fmt(Math.round(num));
    };
    
    qUpdate('.live-views', val.views);
    qUpdate('.live-subs', val.subs);
    qUpdate('.live-likes', eng.likes);
    qUpdate('.live-dislikes', eng.dislikes);
    qUpdate('.live-comments', eng.comments);
    
    if (card.querySelector('.live-like-ratio')) card.querySelector('.live-like-ratio').style.width = ratioPct + '%';
    if (card.querySelector('.live-like-pct'))  card.querySelector('.live-like-pct').textContent  = ratioPct + '% liked';

    // Mini bars
    const barEls = card.querySelectorAll('.mini-bar');
    if (barEls.length === 12) {
      const samples = Array.from({ length: 12 }, (_, i) =>
        valueAtSecond(v, Math.round((i / 11) * t)).views
      );
      const maxBar = Math.max(...samples, 1);
      barEls.forEach((bar, i) => { bar.style.height = ((samples[i] / maxBar) * 100).toFixed(1) + '%'; });
    }
  });
}

// ══════════════════════════════════════════
//  CHANNELS SIDEBAR
// ══════════════════════════════════════════
function renderChannels() {
  const list       = document.getElementById('channels-list');
  const filterSel  = document.getElementById('filter-channel');
  const videoChSel = document.getElementById('video-channel');

  if (state.channels.length === 0) {
    list.innerHTML = '<div class="empty-state small">No channels yet.<br/>Add one to start!</div>';
    filterSel.innerHTML  = '<option value="all">All Channels</option>';
    videoChSel.innerHTML = '<option value="">— Select a channel —</option>'; return;
  }

  const t = playback.currentSecond;

  // Build sub totals first so we can sort
  const chWithSubs = state.channels.map(ch => {
    let subs = ch.baseSubs;
    state.videos.filter(v => v.channelId === ch.id).forEach(v => { subs += valueAtSecond(v, t).subs; });
    return { ch, subs };
  }).sort((a, b) => b.subs - a.subs);  // highest first

  list.innerHTML = chWithSubs.map(({ ch, subs }) => `
      <div class="channel-card" style="--channel-color:${ch.color}" data-id="${ch.id}" id="ch-card-${ch.id}">
        <div class="channel-dot" style="background:${ch.color}">${ch.name[0].toUpperCase()}</div>
        <div class="channel-info">
          <div class="channel-name">${ch.name}</div>
          <div class="channel-meta">${ch.niche} · ${fmt(Math.round(subs))} subs</div>
        </div>
        <button class="btn-compare" data-compare="${ch.id}">VS</button>
        <button class="channel-delete" data-delete="${ch.id}" title="Delete">🗑</button>
      </div>`
  ).join('');

  filterSel.innerHTML  = '<option value="all">All Channels</option>' +
    state.channels.map(ch => `<option value="${ch.id}">${ch.name}</option>`).join('');
  videoChSel.innerHTML = '<option value="">— Select a channel —</option>' +
    state.channels.map(ch => `<option value="${ch.id}">${ch.name}</option>`).join('');
}

// ══════════════════════════════════════════
//  FULL RENDER
// ══════════════════════════════════════════
function renderAll() {
  renderChannels(); renderVideos(); renderChart();
  updateCounters(); updatePlaybackUI();
}

// ══════════════════════════════════════════
//  MODALS
// ══════════════════════════════════════════
function openChannelModal() {
  document.getElementById('channel-name').value  = '';
  document.getElementById('channel-subs').value  = '0';
  document.getElementById('channel-color').value = '#7c3aed';
  document.querySelectorAll('.color-preset').forEach(p => p.classList.remove('selected'));
  document.getElementById('modal-channel').style.display = 'flex';
  setTimeout(() => document.getElementById('channel-name').focus(), 100);
}
function closeChannelModal() { document.getElementById('modal-channel').style.display = 'none'; }

function openVideoModal() {
  if (state.channels.length === 0) { showToast('⚠️ Add a channel first!'); return; }
  document.getElementById('video-title').value             = '';
  document.getElementById('video-quality').value           = 5;
  document.getElementById('video-clickbait').value         = 5;
  document.getElementById('quality-display').textContent   = 5;
  document.getElementById('clickbait-display').textContent = 5;
  document.getElementById('video-date').value              = new Date().toISOString().slice(0, 10);
  document.getElementById('modal-video').style.display     = 'flex';
  setTimeout(() => document.getElementById('video-title').focus(), 100);
}
function closeVideoModal() { document.getElementById('modal-video').style.display = 'none'; }

// ══════════════════════════════════════════
//  CRUD
// ══════════════════════════════════════════
function saveChannel() {
  const name  = document.getElementById('channel-name').value.trim();
  const niche = document.getElementById('channel-niche').value;
  const color = document.getElementById('channel-color').value;
  const subs  = parseInt(document.getElementById('channel-subs').value) || 0;
  if (!name) { showToast('⚠️ Enter a channel name!'); return; }
  if (state.channels.find(c => c.name.toLowerCase() === name.toLowerCase())) { showToast('⚠️ Name already exists!'); return; }
  state.channels.push({ id: uid(), name, niche, color, baseSubs: subs });
  saveState(); closeChannelModal(); renderAll();
  showToast(`✅ Channel "${name}" created!`);
}

function deleteChannel(id) {
  const ch = state.channels.find(c => c.id === id);
  if (!ch) return;
  state.channels = state.channels.filter(c => c.id !== id);
  state.videos   = state.videos.filter(v => v.channelId !== id);
  saveState(); renderAll();
  showToast(`🗑 Deleted "${ch.name}"`);
}

function toggleCompare(id) {
  if (playback.compareIds.includes(id)) {
    playback.compareIds = playback.compareIds.filter(x => x !== id);
  } else {
    if (playback.compareIds.length >= 4) {
      showToast('⚠️ Max 4 channels for comparison!');
      return;
    }
    playback.compareIds.push(id);
  }
  // Reset comparison charts when selection changes
  if (compareTotalsChart) { compareTotalsChart.destroy(); compareTotalsChart = null; }
  if (compareGainsChart) { compareGainsChart.destroy(); compareGainsChart = null; }
  renderAll();
}

function saveVideo() {
  const title     = document.getElementById('video-title').value.trim();
  const channelId = document.getElementById('video-channel').value;
  const type      = document.getElementById('video-type').value;
  const quality   = parseInt(document.getElementById('video-quality').value);
  const clickbait = parseInt(document.getElementById('video-clickbait').value);
  const date      = document.getElementById('video-date').value || new Date().toISOString().slice(0, 10);
  if (!title)     { showToast('⚠️ Enter a video title!'); return; }
  if (!channelId) { showToast('⚠️ Select a channel!'); return; }
  const ch = state.channels.find(c => c.id === channelId);
  if (!ch) { showToast('⚠️ Channel not found!'); return; }
  const video = { id: uid(), title, channelId, type, quality, clickbait, date };
  video.projection = projectGrowth(video, ch);
  state.videos.push(video);
  saveState(); closeVideoModal();
  pausePlayback(); playback.currentSecond = 0;
  renderAll(); startPlayback();
  showToast(`🚀 "${title}" added! Simulating…`);
}

function deleteVideo(id) {
  const v = state.videos.find(v => v.id === id);
  if (!v) return;
  delete thumbnailCache[id];
  state.videos = state.videos.filter(vid => vid.id !== id);
  saveState(); renderAll();
  showToast(`🗑 Deleted "${v.title}"`);
}

// ══════════════════════════════════════════
//  COMPARISON LOGIC
// ══════════════════════════════════════════
let compareChart = null;

function updateComparison() {
  const compSection = document.getElementById('comparison-section');
  if (playback.compareIds.length < 2) {
    compSection.style.display = 'none';
    return;
  }
  compSection.style.display = 'flex';

  const t = playback.currentSecond;
  const ch1 = state.channels.find(c => c.id === playback.compareIds[0]);
  const ch2 = state.channels.find(c => c.id === playback.compareIds[1]);
  if (!ch1 || !ch2) return;

  const getSubs = (ch) => {
    let s = ch.baseSubs;
    state.videos.filter(v => v.channelId === ch.id).forEach(v => { s += valueAtSecond(v, t).subs; });
    return Math.round(s);
  };

  const subs1 = getSubs(ch1);
  const subs2 = getSubs(ch2);
  const gap = Math.abs(subs1 - subs2);

  document.getElementById('comp-name-1').textContent = ch1.name;
  document.getElementById('comp-name-2').textContent = ch2.name;

  const updateOd = (id, val) => {
    const el = document.getElementById(id);
    if (!el.odInstance) {
      el.innerHTML = '';
      el.odInstance = new Odometer({ el, value: val, duration: 300 });
    } else {
      el.odInstance.update(val);
    }
  };

  updateOd('comp-subs-1', subs1);
  updateOd('comp-subs-2', subs2);
  updateOd('comp-gap', gap);

  const winnerEl = document.getElementById('comp-winner');
  if (subs1 > subs2) winnerEl.textContent = `👑 ${ch1.name} is leading by ${fmt(gap)}`;
  else if (subs2 > subs1) winnerEl.textContent = `👑 ${ch2.name} is leading by ${fmt(gap)}`;
  else winnerEl.textContent = "Tie! The race is neck and neck.";

  renderCompareChart(ch1, ch2);
}

function renderCompareChart(ch1, ch2) {
  const canvas = document.getElementById('compare-line-chart');
  if (!canvas) return;

  // Re-generate chart if channels change or first time
  const chartKey = `${ch1.id}_vs_${ch2.id}`;
  if (canvas.dataset.key !== chartKey) {
    if (compareChart) { compareChart.destroy(); compareChart = null; }
    canvas.dataset.key = chartKey;
  }

  if (compareChart) return; // Only render trajectory once per VS pair to save perf

  const labels = Array.from({ length: 61 }, (_, i) => i === 0 ? 'Start' : `Yr ${Math.floor(i/12)} M${i%12}`);
  const getTrajectory = (ch) => {
    const data = [];
    const videos = state.videos.filter(v => v.channelId === ch.id);
    for (let m = 0; m <= 60; m++) {
      let s = ch.baseSubs;
      videos.forEach(v => {
        if (v.projection) s += v.projection.subsByMonth[Math.min(m, 59)] || 0;
      });
      data.push(s);
    }
    return data;
  };

  compareChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: ch1.name, data: getTrajectory(ch1), borderColor: ch1.color, backgroundColor: ch1.color + '22', fill: true, tension: 0.3, pointRadius: 0 },
        { label: ch2.name, data: getTrajectory(ch2), borderColor: ch2.color, backgroundColor: ch2.color + '22', fill: true, tension: 0.3, pointRadius: 0 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { labels: { color: '#8b92b8', font: { family: 'Inter', size: 12 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}` } }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#4b5275', maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
        y: { 
          grid: { color: 'rgba(255,255,255,0.03)' }, 
          ticks: { color: '#8b92b8', callback: v => fmt(v) }
        }
      }
    }
  });
}

// ══════════════════════════════════════════
//  EVENT LISTENERS
// ══════════════════════════════════════════
document.getElementById('btn-add-channel').addEventListener('click', openChannelModal);
document.getElementById('btn-add-video').addEventListener('click', openVideoModal);

document.addEventListener('click', e => {
  const chDel = e.target.closest('[data-delete]');
  if (chDel) { e.stopPropagation(); deleteChannel(chDel.dataset.delete); return; }
  const vDel = e.target.closest('[data-delete-video]');
  if (vDel) { deleteVideo(vDel.dataset.deleteVideo); }
});

document.getElementById('channels-list').addEventListener('click', e => {
  const compBtn = e.target.closest('[data-compare]');
  if (compBtn) {
    e.stopPropagation();
    toggleCompare(compBtn.dataset.compare);
    return;
  }

  const card = e.target.closest('.channel-card');
  if (!card || e.target.closest('[data-delete]')) return;
  document.getElementById('filter-channel').value = card.dataset.id;
  document.querySelectorAll('.channel-card').forEach(c => c.classList.remove('active'));
  card.classList.add('active'); renderChart();
});

document.getElementById('close-channel-modal').addEventListener('click', closeChannelModal);
document.getElementById('cancel-channel').addEventListener('click', closeChannelModal);
document.getElementById('save-channel').addEventListener('click', saveChannel);
document.getElementById('channel-name').addEventListener('keydown', e => { if (e.key === 'Enter') saveChannel(); });
document.getElementById('modal-channel').addEventListener('click', e => { if (e.target === e.currentTarget) closeChannelModal(); });

document.getElementById('close-video-modal').addEventListener('click', closeVideoModal);
document.getElementById('cancel-video').addEventListener('click', closeVideoModal);
document.getElementById('save-video').addEventListener('click', saveVideo);
document.getElementById('video-title').addEventListener('keydown', e => { if (e.key === 'Enter') saveVideo(); });
document.getElementById('modal-video').addEventListener('click', e => { if (e.target === e.currentTarget) closeVideoModal(); });

document.getElementById('video-quality').addEventListener('input', e => { document.getElementById('quality-display').textContent = e.target.value; });
document.getElementById('video-clickbait').addEventListener('input', e => { document.getElementById('clickbait-display').textContent = e.target.value; });

function autoAnalyzeTitle(title) {
  if (!title.trim()) {
    document.getElementById('video-quality').value = 5;
    document.getElementById('video-clickbait').value = 5;
    document.getElementById('quality-display').textContent = 5;
    document.getElementById('clickbait-display').textContent = 5;
    return;
  }
  
  const text = title.toLowerCase();
  let qScore = 5;
  let cScore = 5;
  
  const cbWords = ['omg','insane','secret','truth','destroy','million','billion','shocking','gone wrong','crazy','never','unbelievable','won\'t believe','free','giveaway','prank','scary','spooky','ghost','survive','extreme','exposed','exposing','hack','cheat'];
  const qWords  = ['tutorial','guide','review','documentary','how to','analysis','study','podcast','interview','cinematic','build','setup','making of','behind the scenes','vlog','day in the life','essay'];
  
  const capsCount = (title.match(/[A-Z]{2,}/g) || []).length;
  const exclaimCount = (title.match(/[!?]/g) || []).length;
  
  cScore += Math.min(3, exclaimCount * 0.5 + capsCount * 0.5);
  qScore -= capsCount > 1 ? 1 : 0;
  
  cbWords.forEach(w => { if(text.includes(w)) { cScore += 1.5; qScore -= 0.5; } });
  qWords.forEach(w => { if(text.includes(w)) { qScore += 2; cScore -= 1; } });
  
  // Deterministic noise
  const rng = seededRng(title)();
  qScore += (rng * 2 - 1); 
  cScore += (rng * 2 - 1); 
  
  if (text.length < 15) qScore -= 1;
  if (text.length > 50 && cScore > 6) cScore += 1;
  
  const finalQ = Math.max(1, Math.min(10, Math.round(qScore)));
  const finalC = Math.max(1, Math.min(10, Math.round(cScore)));
  
  document.getElementById('video-quality').value = finalQ;
  document.getElementById('video-clickbait').value = finalC;
  document.getElementById('quality-display').textContent = finalQ + ' 🤖';
  document.getElementById('clickbait-display').textContent = finalC + ' 🤖';
}

document.getElementById('video-title').addEventListener('input', e => autoAnalyzeTitle(e.target.value));

document.getElementById('filter-channel').addEventListener('change', () => { renderChart(); updateMilestones(); });
document.getElementById('filter-metric').addEventListener('change',  () => { renderChart(); updateMilestones(); });

document.getElementById('btn-apply-start-date').addEventListener('click', () => {
  const val = document.getElementById('sim-start-date').value;
  if (!val) { showToast('⚠️ Pick a date first'); return; }
  saveSimStart(val);
});
document.getElementById('sim-start-date').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-apply-start-date').click();
});
document.getElementById('btn-download-csv').addEventListener('click', downloadCSV);

document.getElementById('ui-update-interval').addEventListener('change', e => {
  playback.updateIntervalMs = parseInt(e.target.value);
  document.getElementById('custom-tick-ms').value = playback.updateIntervalMs;
});

document.getElementById('custom-tick-ms').addEventListener('input', e => {
  const val = parseInt(e.target.value);
  if (val >= 16) {
    playback.updateIntervalMs = val;
    document.getElementById('ui-update-interval').value = ""; // Clear dropdown if custom used
  }
});

document.getElementById('btn-play-pause').addEventListener('click', togglePlayback);
document.getElementById('btn-step-back').addEventListener('click', () => stepPlayback(-1));
document.getElementById('btn-step-forward').addEventListener('click', () => stepPlayback(1));
document.getElementById('btn-reset-pb').addEventListener('click', resetPlayback);
document.getElementById('pb-speed').addEventListener('change', e => { playback.speed = parseInt(e.target.value); });
document.getElementById('pb-scrubber').addEventListener('input', e => {
  playback.currentSecond = parseInt(e.target.value);
  if (compareTotalsChart) { compareTotalsChart.destroy(); compareTotalsChart = null; }
  if (compareGainsChart) { compareGainsChart.destroy(); compareGainsChart = null; }
  doFrame(performance.now());
});

function stepPlayback(dir) {
  playback.currentSecond = Math.max(0, Math.min(TOTAL_SECONDS, playback.currentSecond + dir * playback.speed));
  if (dir < 0) {
    if (compareTotalsChart) { compareTotalsChart.destroy(); compareTotalsChart = null; }
    if (compareGainsChart) { compareGainsChart.destroy(); compareGainsChart = null; }
  }
  doFrame(performance.now());
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeChannelModal(); closeVideoModal(); }
  if (e.key === ' ' && e.target === document.body) { e.preventDefault(); togglePlayback(); }
});

// ══════════════════════════════════════════
//  COLOR PRESETS
// ══════════════════════════════════════════
function buildColorPresets() {
  const container = document.getElementById('color-presets');
  container.innerHTML = COLOR_PRESETS.map(c =>
    `<div class="color-preset" style="background:${c}" data-color="${c}"></div>`
  ).join('');
  container.addEventListener('click', e => {
    const p = e.target.closest('.color-preset');
    if (!p) return;
    document.getElementById('channel-color').value = p.dataset.color;
    container.querySelectorAll('.color-preset').forEach(x => x.classList.remove('selected'));
    p.classList.add('selected');
  });
}

// ══════════════════════════════════════════
//  SCRIPT LOADERS
// ══════════════════════════════════════════
function loadChartJs(cb) {
  if (window.Chart) { cb(); return; }
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js';
  s.onload = cb; document.head.appendChild(s);
}
function loadDatalabels(cb) {
  if (window.ChartDataLabels) { Chart.register(ChartDataLabels); cb(); return; }
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js';
  s.onload = () => { Chart.register(ChartDataLabels); cb(); };
  document.head.appendChild(s);
}

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
function init() {
  buildColorPresets();
  loadSimStart();
  loadState();
  loadChartJs(() => loadDatalabels(() => {
    renderAll();
    if (state.videos.length > 0) { playback.currentSecond = 0; startPlayback(); }
  }));
}

init();
// ══════════════════════════════════════════
//  COMPARISON DASHBOARD LOGIC
// ══════════════════════════════════════════
// ══════════════════════════════════════════
//  COMPARISON DASHBOARD LOGIC (High Fidelity)
// ══════════════════════════════════════════
let compareTotalsChart = null;
let compareGainsChart = null;

function updateComparison() {
  const ids = playback.compareIds;
  const section = document.getElementById('comparison-section');
  if (ids.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'flex';

  const t = playback.currentSecond;
  const chStats = [];

  // Helper for subs at offset
  const getSubsAt = (ch, time) => {
    let s = ch.baseSubs;
    state.videos.filter(v => v.channelId === ch.id).forEach(v => {
      s += valueAtSecond(v, time).subs;
    });
    return s;
  };

  // 1. Update Cards
  for (let i = 1; i <= 4; i++) {
    const slot = document.getElementById(`comp-slot-${i}`);
    const id = ids[i - 1];
    if (!id) {
      slot.style.display = 'none';
      continue;
    }
    slot.style.display = 'flex';
    const ch = state.channels.find(c => c.id === id);

    const subsNow  = getSubsAt(ch, t);
    const subsPrev = getSubsAt(ch, Math.max(0, t - 86400));
    const subs30d  = getSubsAt(ch, Math.max(0, t - 2592000));
    
    const gainDay = Math.round(subsNow - subsPrev);
    const gainMonth = Math.round(subsNow - subs30d);

    chStats.push({ id: ch.id, name: ch.name, subs: subsNow, gainDay, color: ch.color, el: slot });

    // Thematic Styling
    slot.style.setProperty('--channel-color', ch.color);
    slot.style.setProperty('--card-bg', `${ch.color}22`);
    slot.style.setProperty('--card-text-color', ch.color);

    document.getElementById(`comp-name-${i}`).textContent = ch.name;
    document.getElementById(`comp-logo-${i}`).textContent = ch.name.charAt(0).toUpperCase();
    document.getElementById(`comp-gain-day-${i}`).textContent = `+${fmt(gainDay)}/day`;
    document.getElementById(`comp-gain-30d-${i}`).textContent = `+${fmt(gainMonth)}/30d`;

    const subEl = document.getElementById(`comp-subs-${i}`);
    if (!subEl.odInstance) {
      subEl.innerHTML = '';
      subEl.odInstance = new Odometer({ el: subEl, value: Math.round(subsNow) });
    }
    subEl.odInstance.update(Math.round(subsNow));
  }

  // 2. Identify Leader & Velocity Fire
  const leaderStats = [...chStats].sort((a, b) => b.subs - a.subs);
  const velocityStats = [...chStats].sort((a, b) => b.gainDay - a.gainDay);

  chStats.forEach((stat) => {
    const fireContainer = document.getElementById(`comp-fire-${playback.compareIds.indexOf(stat.id) + 1}`);
    if (fireContainer) {
      if (stat.id === velocityStats[0].id && velocityStats.length > 1) {
        fireContainer.classList.add('active');
      } else {
        fireContainer.classList.remove('active');
      }
    }
    
    if (stat.id === leaderStats[0].id && leaderStats.length > 1) {
      stat.el.classList.add('leader');
    } else {
      stat.el.classList.remove('leader');
    }
  });

  const gapEl = document.getElementById('comp-gap');
  const winnerEl = document.getElementById('comp-winner');
  if (chStats.length >= 2) {
    const gap = chStats[0].subs - chStats[1].subs;
    if (!gapEl.odInstance) {
      gapEl.innerHTML = '';
      gapEl.odInstance = new Odometer({ el: gapEl, value: Math.round(gap) });
    }
    gapEl.odInstance.update(Math.round(gap));
    winnerEl.textContent = `${chStats[0].name} is in the lead!`;
  } else {
    winnerEl.textContent = "Battle in progress...";
  }

  // 3. Dual Chart Updates
  updateCompareCharts(t, chStats);
}

function updateCompareCharts(t, chStats) {
  // Common Scale Options
  const scaleOps = {
    x: { type: 'linear', display: true, grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { display: false } },
    y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#555', font: { size: 10 }, callback: v => fmt(v) } }
  };

  // --- CHART 1: TOTALS ---
  if (!compareTotalsChart) {
    const ctx = document.getElementById('compare-line-chart').getContext('2d');
    compareTotalsChart = new Chart(ctx, {
      type: 'line',
      data: { datasets: chStats.map(s => ({ label: s.name, data: [], borderColor: s.color, backgroundColor: s.color+'11', tension: 0.3, pointRadius: 0, borderWidth: 3 })) },
      options: { responsive: true, maintainAspectRatio: false, animation: false, scales: scaleOps, plugins: { legend: { display: false }, datalabels: { display: false } } }
    });
  }

  // --- CHART 2: VELOCITY (GAIN PER STEP) ---
  if (!compareGainsChart) {
    const ctx = document.getElementById('compare-velocity-chart').getContext('2d');
    compareGainsChart = new Chart(ctx, {
      type: 'line',
      data: { datasets: chStats.map(s => ({ label: s.name, data: [], borderColor: s.color, backgroundColor: s.color+'11', tension: 0.3, pointRadius: 0, borderWidth: 2 })) },
      options: { responsive: true, maintainAspectRatio: false, animation: false, scales: scaleOps, plugins: { legend: { display: false }, datalabels: { display: false } } }
    });
  }

  // Security: if t moves backward, reset
  const checkReset = (chart) => {
    if (chart.data.datasets[0].data.length > 0) {
      if (t < chart.data.datasets[0].data[chart.data.datasets[0].data.length-1].x) {
        chart.destroy(); return true;
      }
    }
    return false;
  };

  if (checkReset(compareTotalsChart)) { compareTotalsChart = null; return; }
  if (checkReset(compareGainsChart)) { compareGainsChart = null; return; }

  // Push points
  chStats.forEach(stat => {
    const dsT = compareTotalsChart.data.datasets.find(d => d.label === stat.name);
    if (dsT) dsT.data.push({ x: t, y: stat.subs });

    const dsG = compareGainsChart.data.datasets.find(d => d.label === stat.name);
    if (dsG) dsG.data.push({ x: t, y: stat.gainDay });
  });

  // Performance cap
  if (compareTotalsChart.data.datasets[0].data.length > 600) {
    compareTotalsChart.data.datasets.forEach(d => d.data.shift());
    compareGainsChart.data.datasets.forEach(d => d.data.shift());
  }

  compareTotalsChart.update('none');
  compareGainsChart.update('none');
}
