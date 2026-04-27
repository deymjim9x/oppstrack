/* ════════════════════════════════════════════════
   OppsTrack — Main Application (Supabase Edition)
════════════════════════════════════════════════ */

// ── Supabase Client ─────────────────────────────
const SUPABASE_URL = 'https://ouyemnnrmwyqpnspdzqn.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91eWVtbm5ybXd5cXBuc3BkenFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMDgzMTAsImV4cCI6MjA5Mjc4NDMxMH0.NEryKfJFvPiaQtvV5Zg32bEuT_SCBtku47eV4ZehYnk';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── State ──────────────────────────────────────
let currentUser    = null;
let currentSection = 'dashboard';
let currentChatId  = null;
let _msgChannel    = null;
let _cachedUsers   = [];

// ── Palette ────────────────────────────────────
const GRADIENTS = [
  '135deg, #58a6ff, #bc8cff',
  '135deg, #3fb950, #06b6d4',
  '135deg, #f97316, #facc15',
  '135deg, #ec4899, #8b5cf6',
  '135deg, #06b6d4, #3b82f6',
  '135deg, #84cc16, #22c55e',
];

function getUserGradient(userId) {
  const idx = _cachedUsers.findIndex(u => u.id === userId);
  return GRADIENTS[(idx < 0 ? 0 : idx) % GRADIENTS.length];
}

function getInitials(name) {
  return name.trim().split(/\s+/).map(w => w[0].toUpperCase()).slice(0, 2).join('');
}

// ── Toast ──────────────────────────────────────
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  setTimeout(() => el.className = 'toast', 3000);
}

// ── Modal ──────────────────────────────────────
const Modal = {
  show(title, html, wide = false) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = html;
    const overlay = document.getElementById('modal-overlay');
    overlay.querySelector('.modal').style.maxWidth = wide ? '700px' : '520px';
    overlay.classList.add('open');
    setTimeout(() => { const f = overlay.querySelector('input,textarea'); if (f) f.focus(); }, 50);
  },
  close() {
    const modal = document.querySelector('#modal-overlay .modal');
    if (modal) { modal.style.background = ''; modal.style.borderColor = ''; }
    document.getElementById('modal-overlay').classList.remove('open');
    document.getElementById('modal-body').innerHTML = '';
  }
};

/* ════════════════════════════════════════════════
   USERS
════════════════════════════════════════════════ */
const Users = {
  async getAll() {
    const { data, error } = await sb.from('users').select('*').order('created');
    if (error) { console.error('getAll users error:', error); toast('DB error: ' + error.message, 'error'); }
    _cachedUsers = data || [];
    return _cachedUsers;
  },
  async get(id) {
    const cached = _cachedUsers.find(u => u.id === id);
    if (cached) return cached;
    const { data, error } = await sb.from('users').select('*').eq('id', id).single();
    if (error) console.error('get user error:', error);
    return data || null;
  },
  async add(user) {
    const { error } = await sb.from('users').insert(user);
    if (error) { console.error('add user error:', error); toast('Could not save user: ' + error.message, 'error'); return false; }
    return true;
  },
  async remove(id) {
    await sb.from('users').delete().eq('id', id);
  },
  async confirmDelete(id, e) {
    e.stopPropagation();
    const u = _cachedUsers.find(u => u.id === id);
    if (!u) return;
    if (u.pin_hash) {
      this._showDeleteModal(u);
    } else {
      if (!confirm(`Remove "${u.name}"? All their data will be deleted.`)) return;
      await this._doDelete(u);
    }
  },

  _QUESTIONS: {
    pet:    "What is your first pet's name?",
    color:  "What is your favorite color?",
    band:   "Name of your favorite band?",
    animal: "What animal scares you the most?",
    catdog: "Cat or Dog?",
  },

  _showDeleteModal(u) {
    const q = u.secret_question ? this._QUESTIONS[u.secret_question] : null;
    Modal.show(`Delete Profile`, `
      <p style="font-size:13px;color:var(--red);margin-bottom:16px">⚠️ Permanently delete <strong>${esc(u.name)}</strong> and all their data?</p>
      <div class="form-group">
        <label class="form-label">Enter PIN</label>
        <input class="form-input" id="del-pin" type="password" inputmode="numeric" maxlength="6" placeholder="••••••" autofocus>
      </div>
      ${q ? `<div class="form-group">
        <label class="form-label">${esc(q)}</label>
        <input class="form-input" id="del-secret" type="text" placeholder="Your answer...">
      </div>` : ''}
      <p id="del-err" style="color:var(--red);font-size:13px;min-height:18px"></p>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
        <button class="btn btn-danger" style="border:1px solid var(--red)" onclick="Users._verifyDelete('${u.id}')">Delete</button>
      </div>`);
  },

  async _verifyDelete(id) {
    const u = _cachedUsers.find(u => u.id === id);
    if (!u) return;
    const errEl = document.getElementById('del-err');

    const pin = document.getElementById('del-pin')?.value.trim();
    if (!pin) { errEl.textContent = 'Please enter the PIN'; return; }
    const pinHash = await PinAuth._hash(pin);
    if (pinHash !== u.pin_hash) { errEl.textContent = 'Incorrect PIN'; return; }

    if (u.secret_question && u.secret_answer) {
      const ans = document.getElementById('del-secret')?.value.trim().toLowerCase();
      if (!ans) { errEl.textContent = 'Please answer the secret question'; return; }
      if (ans !== u.secret_answer) { errEl.textContent = 'Incorrect answer'; return; }
    }

    Modal.close();
    await this._doDelete(u);
  },

  async _doDelete(u) {
    localStorage.removeItem(`oppstrack_pin_${u.id}`);
    localStorage.removeItem(`oppstrack_avatar_${u.id}`);
    await this.remove(u.id);
    await renderLoginPage();
    toast(`${u.name} removed`);
  }
};

/* ════════════════════════════════════════════════
   AVATAR (synced to Supabase, cached in localStorage)
════════════════════════════════════════════════ */
const Avatar = {
  get(id) {
    const user = _cachedUsers.find(u => u.id === id);
    if (user && user.avatar) return user.avatar;
    return localStorage.getItem(`oppstrack_avatar_${id}`) || null;
  },

  async set(id, dataUrl) {
    const compressed = await this._resize(dataUrl, 120);
    localStorage.setItem(`oppstrack_avatar_${id}`, compressed);
    await sb.from('users').update({ avatar: compressed }).eq('id', id);
    const user = _cachedUsers.find(u => u.id === id);
    if (user) user.avatar = compressed;
    if (currentUser && currentUser.id === id) this._applySidebar(compressed, id);
  },

  _resize(dataUrl, size) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2, sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = dataUrl;
    });
  },

  _applySidebar(dataUrl, id) {
    const av = document.getElementById('sidebar-avatar');
    if (!av) return;
    if (dataUrl) {
      av.innerHTML = `<img src="${dataUrl}" alt="avatar">`;
      av.style.background = '';
    } else {
      av.innerHTML = getInitials(currentUser.name);
      av.style.background = `linear-gradient(${getUserGradient(id)})`;
    }
  },

  openPicker() { document.getElementById('avatar-input').click(); },

  handleUpload(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => { this.set(currentUser.id, e.target.result).then(() => toast('Profile photo updated!')); };
    reader.readAsDataURL(file);
  }
};

/* ════════════════════════════════════════════════
   REGISTRATION
════════════════════════════════════════════════ */
const Reg = {
  _photo: null,

  open() {
    this._photo = null;
    document.getElementById('reg-overlay').classList.add('open');
    document.getElementById('reg-name').value = '';
    document.getElementById('reg-pin-toggle').checked = false;
    document.getElementById('reg-pin-wrap').style.display = 'none';
    document.getElementById('reg-error').textContent = '';
    document.getElementById('reg-secret-q').value = '';
    document.getElementById('reg-secret-a').value = '';
    this._resetAvatar();
    this._clearPinDigits();
    setTimeout(() => document.getElementById('reg-name').focus(), 100);
  },

  close() {
    document.getElementById('reg-overlay').classList.remove('open');
  },

  _resetAvatar() {
    document.getElementById('reg-avatar-preview').innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="28" height="28"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
      <span>Add Photo</span>`;
    this._photo = null;
  },

  handlePhoto(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      this._photo = e.target.result;
      document.getElementById('reg-avatar-preview').innerHTML =
        `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
    };
    reader.readAsDataURL(file);
  },

  togglePin(on) {
    document.getElementById('reg-pin-wrap').style.display = on ? '' : 'none';
    if (on) {
      this._clearPinDigits();
      setTimeout(() => document.querySelector('#reg-pin-digits .pin-digit')?.focus(), 50);
    }
  },

  _clearPinDigits() {
    document.querySelectorAll('#reg-pin-digits .pin-digit').forEach(i => { i.value = ''; i.classList.remove('filled'); });
  },

  _getPinValue() {
    return Array.from(document.querySelectorAll('#reg-pin-digits .pin-digit')).map(i => i.value).join('');
  },

  async submit() {
    const name = document.getElementById('reg-name').value.trim();
    const errEl = document.getElementById('reg-error');
    if (!name) { errEl.textContent = 'Please enter a name'; return; }

    const pinOn = document.getElementById('reg-pin-toggle').checked;
    let pinHash = null;

    let secretQuestion = null, secretAnswer = null;
    if (pinOn) {
      const pin = this._getPinValue();
      if (pin.length < 6) { errEl.textContent = 'Please enter all 6 PIN digits'; return; }
      pinHash = await PinAuth._hash(pin);
      secretQuestion = document.getElementById('reg-secret-q').value;
      secretAnswer   = document.getElementById('reg-secret-a').value.trim().toLowerCase();
      if (!secretQuestion) { errEl.textContent = 'Please select a secret question'; return; }
      if (!secretAnswer)   { errEl.textContent = 'Please enter your secret answer'; return; }
    }

    const avatar = this._photo ? await Avatar._resize(this._photo, 120) : null;
    const user = { id: uid(), name, created: new Date().toISOString(), pin_hash: pinHash || null, avatar, secret_question: secretQuestion, secret_answer: secretAnswer };
    const ok = await Users.add(user);
    if (!ok) return;

    if (avatar) localStorage.setItem(`oppstrack_avatar_${user.id}`, avatar);
    if (pinHash) localStorage.setItem(`oppstrack_pin_${user.id}`, pinHash);

    this.close();
    await renderLoginPage();
    toast(`Welcome, ${name}!`);
  }
};

/* ════════════════════════════════════════════════
   AUTH
════════════════════════════════════════════════ */
async function renderLoginPage() {
  const users = await Users.getAll();
  const grid  = document.getElementById('users-grid');
  let html = '';

  users.forEach(u => {
    const pic      = Avatar.get(u.id);
    const gradient = getUserGradient(u.id);
    const initials = getInitials(u.name);
    const hasPin   = PinAuth.hasPin(u.id);
    html += `
      <div class="user-card" onclick="selectUser('${u.id}')">
        <div class="ucard-av" style="${pic ? '' : `background:linear-gradient(${gradient})`}">
          ${pic ? `<img src="${pic}" alt="${esc(u.name)}">` : `<span>${initials}</span>`}
        </div>
        ${hasPin ? '<div class="ucard-lock">🔒</div>' : ''}
        <h3>${esc(u.name)}</h3>
        <p>Click to enter</p>
        <button class="ucard-del" onclick="Users.confirmDelete('${u.id}', event)" title="Remove user">×</button>
      </div>`;
  });

  html += `
    <div class="user-card add-card" onclick="Reg.open()">
      <div class="add-card-icon">＋</div>
      <h3>Add a User</h3>
      <p>Create your profile</p>
    </div>`;

  grid.innerHTML = html;
}

async function selectUser(id) {
  const user = await Users.get(id);
  if (!user) return;
  if (PinAuth.hasPin(id)) PinAuth.prompt(id, user.name);
  else login(user);
}

function login(user) {
  currentUser = user;
  document.getElementById('login-view').style.display  = 'none';
  document.getElementById('app-view').style.display    = 'flex';
  ParticlesBg.stop();

  const av  = document.getElementById('sidebar-avatar');
  const pic = Avatar.get(user.id);
  if (pic) { av.innerHTML = `<img src="${pic}" alt="${esc(user.name)}">`;  av.style.background = ''; }
  else     { av.innerHTML = getInitials(user.name); av.style.background = `linear-gradient(${getUserGradient(user.id)})`; }

  document.getElementById('sidebar-username').textContent   = user.name;
  document.getElementById('pin-sidebar-label').textContent  = PinAuth.hasPin(user.id) ? 'Change PIN' : 'Set PIN';

  currentChatId = null;
  document.getElementById('chat-bubble').classList.add('visible');
  Messages.subscribeRealtime();
  Messages.updateBadge();
  showSection('dashboard');
  AIChat.init();
}

function logout() {
  currentUser = null;
  currentChatId = null;
  if (_msgChannel) { sb.removeChannel(_msgChannel); _msgChannel = null; }
  const bubble = document.getElementById('chat-bubble');
  bubble.classList.remove('visible');
  const panel = document.getElementById('chat-panel');
  panel.classList.remove('open');
  Messages._open = false;
  document.getElementById('app-view').style.display   = 'none';
  document.getElementById('login-view').style.display = '';
  renderLoginPage();
  ParticlesBg.start();
}

/* ════════════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════════════ */
// ── Mobile Sidebar ──────────────────────────────
function openSidebar() {
  document.getElementById('sidebar').classList.add('mobile-open');
  document.getElementById('sidebar-overlay').classList.add('visible');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-overlay').classList.remove('visible');
}

// ── Dark Mode ────────────────────────────────────
function toggleDarkMode(isDark) {
  document.body.classList.toggle('light-mode', !isDark);
  localStorage.setItem('oppstrack_darkmode', isDark ? '1' : '0');
}
function initDarkMode() {
  const saved = localStorage.getItem('oppstrack_darkmode');
  const isDark = saved === null ? true : saved === '1';
  document.body.classList.toggle('light-mode', !isDark);
  const toggle = document.getElementById('darkmode-toggle');
  if (toggle) toggle.checked = isDark;
}

const SECTION_TITLES = {
  dashboard: 'Dashboard', notes: 'Notes', tasks: 'Tasks',
  calendar: 'Calendar', links: 'Links', ai: 'SideKick',
  calculator: 'Calculator'
};

function showSection(name) {
  currentSection = name;
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`section-${name}`)?.classList.add('active');
  document.querySelector(`[data-section="${name}"]`)?.classList.add('active');

  const titleEl = document.getElementById('mobile-section-title');
  if (titleEl) titleEl.textContent = SECTION_TITLES[name] || name;

  closeSidebar();

  const bubble = document.getElementById('chat-bubble');
  if (bubble) bubble.style.display = name === 'ai' ? 'none' : '';

  switch (name) {
    case 'dashboard':  Dashboard.render(); break;
    case 'tasks':      Tasks.render();     break;
    case 'calendar':   Calendar.render();  break;
    case 'links':      Links.render();     break;
    case 'notes':      Notes.render();     break;
    case 'messages':   if (!Messages._open) Messages.togglePanel(); break;
  }
}

/* ════════════════════════════════════════════════
   PARTICLE BACKGROUND
════════════════════════════════════════════════ */
const ParticlesBg = {
  canvas: null, ctx: null, particles: [], mouse: { x: -9999, y: -9999 }, _raf: null, _on: false,

  init() {
    this.canvas = document.getElementById('bg-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.canvas.addEventListener('mousemove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    this.canvas.addEventListener('mouseleave', () => { this.mouse.x = -9999; this.mouse.y = -9999; });
    this._spawn();
    this.start();
  },

  resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this._spawn();
  },

  _spawn() {
    const count = Math.min(Math.floor(this.canvas.width * this.canvas.height / 10000), 130);
    this.particles = Array.from({ length: count }, () => ({
      x:  Math.random() * this.canvas.width,
      y:  Math.random() * this.canvas.height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      r:  Math.random() * 1.8 + 0.6,
      op: Math.random() * 0.45 + 0.15,
      hue: Math.random() < 0.6 ? 215 : 270,
    }));
  },

  start() {
    this._on = true;
    const frame = () => {
      if (!this._on) return;
      this._draw();
      this._raf = requestAnimationFrame(frame);
    };
    frame();
  },

  stop() {
    this._on = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  },

  _draw() {
    const { canvas, ctx, particles, mouse } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > canvas.width)  p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

      const dx = p.x - mouse.x, dy = p.y - mouse.y;
      const d  = Math.sqrt(dx * dx + dy * dy);
      if (d < 120) {
        const f = (120 - d) / 120 * 1.8;
        p.x += (dx / d) * f;
        p.y += (dy / d) * f;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${p.hue}, 85%, 70%, ${p.op})`;
      ctx.fill();
    });

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const d  = Math.sqrt(dx * dx + dy * dy);
        if (d < 130) {
          const op = (1 - d / 130) * 0.25;
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(88,166,255,${op})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }
    }
  }
};

/* ════════════════════════════════════════════════
   PIN AUTH
════════════════════════════════════════════════ */
const PinAuth = {
  _pending: null,

  _key: id => `oppstrack_pin_${id}`,
  hasPin(id) {
    const user = _cachedUsers.find(u => u.id === id);
    if (user) return !!user.pin_hash;
    return !!localStorage.getItem(`oppstrack_pin_${id}`);
  },

  async _hash(pin) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('oppstrack_v1_' + pin));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  async setPin(id, pin) {
    const hash = await this._hash(pin);
    localStorage.setItem(this._key(id), hash);
    await sb.from('users').update({ pin_hash: hash }).eq('id', id);
    const user = _cachedUsers.find(u => u.id === id);
    if (user) user.pin_hash = hash;
  },

  removePin(id) {
    localStorage.removeItem(`oppstrack_pin_${id}`);
    sb.from('users').update({ pin_hash: null }).eq('id', id);
    const user = _cachedUsers.find(u => u.id === id);
    if (user) user.pin_hash = null;
  },

  async checkPin(id, pin) {
    const hash = await this._hash(pin);
    const user = _cachedUsers.find(u => u.id === id);
    if (user && user.pin_hash) return user.pin_hash === hash;
    return localStorage.getItem(this._key(id)) === hash;
  },

  prompt(id, name) {
    this._pending = id;
    this._clear();
    const pic = Avatar.get(id);
    const av  = document.getElementById('pin-avatar');
    av.dataset.user = id;
    if (pic) { av.innerHTML = `<img src="${pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`; av.style.background = ''; }
    else     { av.innerHTML = getInitials(name); av.style.background = `linear-gradient(${getUserGradient(id)})`; }
    document.getElementById('pin-name').textContent  = name;
    document.getElementById('pin-error').textContent = '';
    document.getElementById('pin-overlay').classList.add('open');
    setTimeout(() => document.querySelector('#pin-digits .pin-digit')?.focus(), 100);
  },

  cancel() {
    this._pending = null;
    document.getElementById('pin-overlay').classList.remove('open');
    this._clear();
  },

  async verify() {
    const pin = Array.from(document.querySelectorAll('#pin-digits .pin-digit')).map(i => i.value).join('');
    if (pin.length < 6) { this._err('Please enter all 6 digits'); return; }
    const ok = await this.checkPin(this._pending, pin);
    if (ok) {
      document.getElementById('pin-overlay').classList.remove('open');
      const user = await Users.get(this._pending);
      this._pending = null;
      login(user);
    } else {
      this._err('Incorrect PIN — try again');
      this._clear();
      document.querySelector('#pin-digits .pin-digit')?.focus();
    }
  },

  _err(msg) {
    const el = document.getElementById('pin-error');
    el.textContent = msg;
    el.style.animation = 'none'; el.offsetHeight; el.style.animation = 'shake 0.3s';
  },

  _clear() {
    document.querySelectorAll('#pin-digits .pin-digit').forEach(i => { i.value = ''; i.classList.remove('filled'); });
  }
};

/* ════════════════════════════════════════════════
   PIN SETUP (in-app)
════════════════════════════════════════════════ */
const PinSetup = {
  open() {
    const has  = PinAuth.hasPin(currentUser.id);
    Modal.show(`PIN — ${currentUser.name}`, has
      ? `<p style="font-size:13px;color:var(--text2);margin-bottom:12px">Your account has a PIN.</p>
         <div style="display:flex;flex-direction:column;gap:10px">
           <button class="btn btn-secondary" style="justify-content:center" onclick="PinSetup._form()">Change PIN</button>
           <button class="btn btn-danger" style="justify-content:center;border:1px solid var(--red)" onclick="PinSetup._remove()">Remove PIN</button>
           <button class="btn btn-ghost" style="justify-content:center" onclick="Modal.close()">Cancel</button>
         </div>`
      : `<p style="font-size:13px;color:var(--text2);margin-bottom:12px">No PIN set. Add one for security.</p>
         <div style="display:flex;flex-direction:column;gap:10px">
           <button class="btn btn-primary" style="justify-content:center" onclick="PinSetup._form()">Set PIN</button>
           <button class="btn btn-ghost" style="justify-content:center" onclick="Modal.close()">Cancel</button>
         </div>`);
  },

  _form() {
    Modal.show('Set PIN', `
      <div class="form-group">
        <label class="form-label">New PIN (6 digits)</label>
        <input class="form-input" id="ps-new" type="password" inputmode="numeric" maxlength="6" placeholder="••••••">
      </div>
      <div class="form-group">
        <label class="form-label">Confirm PIN</label>
        <input class="form-input" id="ps-cfm" type="password" inputmode="numeric" maxlength="6" placeholder="••••••">
      </div>
      <p id="ps-err" style="color:var(--red);font-size:13px;min-height:18px"></p>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="PinSetup._save()">Save PIN</button>
      </div>`);
  },

  async _save() {
    const p1 = document.getElementById('ps-new').value.trim();
    const p2 = document.getElementById('ps-cfm').value.trim();
    const er = document.getElementById('ps-err');
    if (!/^\d{6}$/.test(p1)) { er.textContent = 'Must be exactly 6 digits'; return; }
    if (p1 !== p2)            { er.textContent = 'PINs do not match'; return; }
    await PinAuth.setPin(currentUser.id, p1);
    Modal.close();
    document.getElementById('pin-sidebar-label').textContent = 'Change PIN';
    toast('PIN saved!');
  },

  _remove() {
    Modal.show('Remove PIN', `
      <div class="form-group">
        <label class="form-label">Enter current PIN to confirm</label>
        <input class="form-input" id="ps-cur" type="password" inputmode="numeric" maxlength="6" placeholder="••••••">
      </div>
      <p id="ps-err2" style="color:var(--red);font-size:13px;min-height:18px"></p>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
        <button class="btn btn-danger" style="border:1px solid var(--red)" onclick="PinSetup._confirmRemove()">Remove</button>
      </div>`);
  },

  async _confirmRemove() {
    const pin = document.getElementById('ps-cur').value.trim();
    const ok  = await PinAuth.checkPin(currentUser.id, pin);
    if (!ok) { document.getElementById('ps-err2').textContent = 'Incorrect PIN'; return; }
    PinAuth.removePin(currentUser.id);
    Modal.close();
    document.getElementById('pin-sidebar-label').textContent = 'Set PIN';
    toast('PIN removed');
  }
};

/* ════════════════════════════════════════════════
   DASHBOARD
════════════════════════════════════════════════ */
const Dashboard = {
  async render() {
    const [{ data: tasks }, { data: links }, { data: notes }] = await Promise.all([
      sb.from('tasks').select('*').eq('user_id', currentUser.id),
      sb.from('links').select('*').eq('user_id', currentUser.id),
      sb.from('notes').select('*').eq('user_id', currentUser.id).order('created'),
    ]);

    const allTasks = tasks || [];
    const allLinks = links || [];
    const allNotes = notes || [];

    const pending   = allTasks.filter(t => !t.done);
    const completed = allTasks.filter(t => t.done);

    document.getElementById('stat-pending').textContent = pending.length;
    document.getElementById('stat-done').textContent    = completed.length;
    document.getElementById('stat-links').textContent   = allLinks.length;

    const hour  = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    document.getElementById('dashboard-greeting').textContent = `${greet}, ${currentUser.name}!`;

    const badge = document.getElementById('badge-tasks');
    if (pending.length) { badge.textContent = pending.length; badge.style.display = ''; }
    else badge.style.display = 'none';

    // Recent tasks
    const dashTasks = document.getElementById('dash-tasks');
    const recent = allTasks.slice(-5).reverse();
    dashTasks.innerHTML = recent.length
      ? recent.map(t => `<div class="dash-task-item">
          <div class="task-check ${t.done ? 'checked' : ''}" style="pointer-events:none"></div>
          <span style="flex:1;font-size:13px;${t.done ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(t.title)}</span>
          <span class="badge badge-${t.priority}">${t.priority}</span>
        </div>`).join('')
      : '<div class="dash-empty">No tasks yet</div>';

    // Recent notes
    const dashNotes = document.getElementById('dash-notes');
    const recentNotes = allNotes.slice(-6).reverse();
    if (recentNotes.length) {
      dashNotes.innerHTML = `<div class="dash-notes-grid">${
        recentNotes.map(n => {
          const c = Notes.COLORS.find(c => c.id === (n.color || 'default')) || Notes.COLORS[0];
          return `<div class="dash-note-card" style="background:${c.bg};border-color:${c.border}" onclick="showSection('notes')">
            ${n.title ? `<div class="dash-note-title">${esc(n.title)}</div>` : ''}
            <div class="dash-note-body">${esc(n.body || '').replace(/\n/g, '<br>')}</div>
          </div>`;
        }).join('')
      }</div>`;
    } else {
      dashNotes.innerHTML = '<div class="dash-empty">No notes yet</div>';
    }

    // Unread badge
    const unread = await Messages.totalUnread();
    document.getElementById('stat-unread').textContent = unread;
    Messages.updateBadge();

    // Recent messages preview
    const dashMsgs = document.getElementById('dash-messages');
    const others = _cachedUsers.filter(u => u.id !== currentUser.id);
    const convos = await Promise.all(others.map(async o => {
      const msgs = await Messages.getConversation(o.id);
      const last = msgs[msgs.length - 1];
      return last ? { msg: last, other: o } : null;
    }));
    const recentMsgs = convos.filter(Boolean).sort((a, b) => new Date(b.msg.created) - new Date(a.msg.created));

    if (recentMsgs.length === 0) {
      dashMsgs.innerHTML = '<div class="dash-empty">No messages yet</div>';
    } else {
      dashMsgs.innerHTML = recentMsgs.slice(0, 5).map(({ msg, other }) => {
        const sender = msg.from_user_id === currentUser.id ? 'You' : other.name;
        const time   = new Date(msg.created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `<div class="dash-task-item" style="cursor:pointer" onclick="Messages._open||Messages.togglePanel()">
          <span style="font-size:11px;color:var(--accent);min-width:40px">${esc(sender)}</span>
          <span style="flex:1;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(msg.text)}</span>
          <span style="font-size:11px;color:var(--text3)">${time}</span>
        </div>`;
      }).join('');
    }
  }
};

/* ════════════════════════════════════════════════
   TASKS
════════════════════════════════════════════════ */
const Tasks = {
  _filter: 'all',

  async getAll() {
    const { data } = await sb.from('tasks').select('*').eq('user_id', currentUser.id).order('created');
    return data || [];
  },

  filter(f, btn) {
    this._filter = f;
    document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    this.render();
  },

  async render() {
    const tasks = await this.getAll();
    let list = tasks;
    if (this._filter === 'pending')   list = tasks.filter(t => !t.done);
    if (this._filter === 'completed') list = tasks.filter(t => t.done);
    if (this._filter === 'high')      list = tasks.filter(t => t.priority === 'high' && !t.done);

    const el = document.getElementById('tasks-list');
    if (!list.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-state-icon">✓</div><p>${this._filter === 'all' ? 'No tasks yet — add one!' : 'No tasks in this category.'}</p></div>`;
      return;
    }
    el.innerHTML = list.slice().reverse().map(t => `
      <div class="task-card ${t.done ? 'done' : ''}">
        <div class="task-check ${t.done ? 'checked' : ''}" onclick="Tasks.toggle('${t.id}')"></div>
        <div class="task-body">
          <div class="task-title">${esc(t.title)}</div>
          ${t.description ? `<div class="task-desc">${esc(t.description)}</div>` : ''}
          <div class="task-meta">
            <span class="badge badge-${t.priority}">${t.priority}</span>
            ${t.due_date ? `<span class="task-date">Due: ${t.due_date}</span>` : ''}
          </div>
        </div>
        <div class="task-actions">
          <button class="icon-btn" onclick="Tasks.delete('${t.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </div>`).join('');
  },

  openAdd() {
    Modal.show('Add Task', `
      <div class="form-group"><label class="form-label">Title *</label>
        <input class="form-input" id="t-title" placeholder="Task title"></div>
      <div class="form-group"><label class="form-label">Description</label>
        <textarea class="form-textarea" id="t-desc" placeholder="Optional details..."></textarea></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Priority</label>
          <select class="form-select" id="t-priority">
            <option value="medium">Medium</option><option value="high">High</option><option value="low">Low</option>
          </select></div>
        <div class="form-group"><label class="form-label">Due Date</label>
          <input class="form-input" type="date" id="t-due"></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="Tasks.add()">Add Task</button>
      </div>`);
  },

  async add() {
    const title = document.getElementById('t-title').value.trim();
    if (!title) { toast('Please enter a task title', 'error'); return; }
    await sb.from('tasks').insert({
      id: uid(),
      user_id: currentUser.id,
      title,
      description: document.getElementById('t-desc').value.trim(),
      priority: document.getElementById('t-priority').value,
      due_date: document.getElementById('t-due').value,
      done: false,
      created: new Date().toISOString(),
    });
    Modal.close();
    this.render();
    toast('Task added!');
  },

  async toggle(id) {
    const tasks = await this.getAll();
    const t = tasks.find(t => t.id === id);
    if (!t) return;
    await sb.from('tasks').update({ done: !t.done }).eq('id', id);
    this.render();
  },

  async delete(id) {
    await sb.from('tasks').delete().eq('id', id);
    this.render();
    toast('Task deleted');
  }
};

/* ════════════════════════════════════════════════
   CALENDAR
════════════════════════════════════════════════ */
const Calendar = {
  year: new Date().getFullYear(), month: new Date().getMonth(),

  async render() {
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    document.getElementById('cal-month-label').textContent = `${months[this.month]} ${this.year}`;
    await this._renderDays();
  },

  async _renderDays() {
    const { data } = await sb.from('calendar_notes').select('*').eq('user_id', currentUser.id);
    const rows = data || [];
    const cal = {};
    rows.forEach(r => {
      if (!cal[r.date_key]) cal[r.date_key] = [];
      cal[r.date_key].push({ id: r.id, text: r.text, created: r.created });
    });

    const today = new Date(); today.setHours(0,0,0,0);
    const firstDay    = new Date(this.year, this.month, 1).getDay();
    const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();
    const daysInPrev  = new Date(this.year, this.month, 0).getDate();
    let html = '';
    for (let i = firstDay - 1; i >= 0; i--)  html += this._cell(new Date(this.year, this.month-1, daysInPrev-i), true, cal, today);
    for (let d = 1; d <= daysInMonth; d++)     html += this._cell(new Date(this.year, this.month, d), false, cal, today);
    const total = firstDay + daysInMonth;
    const rem   = total % 7 === 0 ? 0 : 7 - (total % 7);
    for (let i = 1; i <= rem; i++)             html += this._cell(new Date(this.year, this.month+1, i), true, cal, today);
    document.getElementById('cal-days').innerHTML = html;
  },

  _cell(date, other, cal, today) {
    const key     = dateKey(date);
    const notes   = cal[key] || [];
    const isToday = date.getTime() === today.getTime();
    const dots    = notes.slice(0,3).map(n => `<div class="day-note-dot">${esc(n.text)}</div>`).join('');
    const more    = notes.length > 3 ? `<div class="day-note-dot" style="opacity:.5">+${notes.length-3} more</div>` : '';
    return `<div class="cal-day ${other?'other-month':''} ${isToday?'today':''}"
      onclick="Calendar.openDay('${key}','${fmtFull(date)}')">
      <div class="day-num">${date.getDate()}</div>
      <div class="day-notes">${dots}${more}</div>
    </div>`;
  },

  prev() { this.month--; if (this.month<0){this.month=11;this.year--;} this.render(); },
  next() { this.month++; if (this.month>11){this.month=0;this.year++;} this.render(); },

  async openDay(key, label) {
    const { data } = await sb.from('calendar_notes').select('*').eq('user_id', currentUser.id).eq('date_key', key);
    const notes = (data || []).map(r => ({ id: r.id, text: r.text }));
    this._modal(key, label, notes);
  },

  _modal(key, label, notes) {
    Modal.show(`📅 ${label}`, `
      <div style="display:flex;flex-direction:column;gap:10px">
        <div id="notes-list" style="display:flex;flex-direction:column;gap:8px">
          ${notes.length ? notes.map(n => `<div class="note-item">
            <span class="note-text">${esc(n.text)}</span>
            <button class="btn btn-danger btn-sm" onclick="Calendar.deleteNote('${key}','${n.id}','${esc(label)}')">×</button>
          </div>`).join('') : '<div class="dash-empty">No notes for this day.</div>'}
        </div>
        <div style="border-top:1px solid var(--border);padding-top:12px">
          <div class="form-group"><label class="form-label">Add a note</label>
            <textarea class="form-textarea" id="new-note" rows="3" placeholder="Write your note..."></textarea></div>
          <div class="modal-footer">
            <button class="btn btn-ghost" onclick="Modal.close()">Close</button>
            <button class="btn btn-primary" onclick="Calendar.addNote('${key}','${esc(label)}')">Add Note</button>
          </div>
        </div>
      </div>`);
  },

  async addNote(key, label) {
    const text = document.getElementById('new-note').value.trim();
    if (!text) return;
    await sb.from('calendar_notes').insert({
      id: uid(),
      user_id: currentUser.id,
      date_key: key,
      text,
      created: new Date().toISOString(),
    });
    this.render();
    this.openDay(key, label);
    toast('Note added!');
  },

  async deleteNote(key, nid, label) {
    await sb.from('calendar_notes').delete().eq('id', nid);
    this.render();
    this.openDay(key, label);
  }
};

/* ════════════════════════════════════════════════
   LINKS
════════════════════════════════════════════════ */
const Links = {
  _q: '',

  async getAll() {
    const { data } = await sb.from('links').select('*').eq('user_id', currentUser.id).order('created');
    return data || [];
  },

  async render() {
    const q     = this._q.toLowerCase();
    const links = await this.getAll();
    const filtered = q ? links.filter(l =>
      l.title.toLowerCase().includes(q) || l.url.toLowerCase().includes(q) ||
      (l.description||'').toLowerCase().includes(q) || (l.tags||[]).some(t => t.toLowerCase().includes(q))
    ) : links;
    const el = document.getElementById('links-grid');
    if (!filtered.length) {
      el.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">🔗</div><p>${!links.length?'No links yet!':'No results.'}</p></div>`;
      return;
    }
    el.innerHTML = filtered.slice().reverse().map(l => {
      const host = (() => { try { return new URL(l.url).hostname; } catch { return ''; } })();
      const tags = (l.tags||[]).map(t => `<span class="link-tag">${esc(t)}</span>`).join('');
      return `<div class="link-card">
        <div class="link-card-top">
          <div style="flex:1"><div class="link-title">${esc(l.title)}</div>
            <div class="link-url"><a href="${esc(l.url)}" target="_blank" rel="noopener">${host||esc(l.url)}</a></div></div>
          <button class="icon-btn" onclick="Links.delete('${l.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
          </button>
        </div>
        ${l.description ? `<div class="link-desc">${esc(l.description)}</div>` : ''}
        ${tags ? `<div class="link-tags">${tags}</div>` : ''}
      </div>`;
    }).join('');
  },

  search(q) { this._q = q; this.render(); },

  openAdd() {
    Modal.show('Add Reference Link', `
      <div class="form-group"><label class="form-label">Title *</label><input class="form-input" id="l-title" placeholder="Link title"></div>
      <div class="form-group"><label class="form-label">URL *</label><input class="form-input" id="l-url" type="url" placeholder="https://..."></div>
      <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="l-desc" placeholder="What is this?"></textarea></div>
      <div class="form-group"><label class="form-label">Tags (comma separated)</label><input class="form-input" id="l-tags" placeholder="research, tools"></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="Links.add()">Add Link</button>
      </div>`);
  },

  async add() {
    const title = document.getElementById('l-title').value.trim();
    const url   = document.getElementById('l-url').value.trim();
    if (!title || !url) { toast('Title and URL required', 'error'); return; }
    const tags  = document.getElementById('l-tags').value.split(',').map(t=>t.trim()).filter(Boolean);
    await sb.from('links').insert({
      id: uid(),
      user_id: currentUser.id,
      title,
      url,
      description: document.getElementById('l-desc').value.trim(),
      tags,
      created: new Date().toISOString(),
    });
    Modal.close();
    this.render();
    toast('Link added!');
  },

  async delete(id) {
    await sb.from('links').delete().eq('id', id);
    this.render();
    toast('Link deleted');
  }
};

/* ════════════════════════════════════════════════
   NOTES
════════════════════════════════════════════════ */
const Notes = {
  _q: '',

  COLORS: [
    { id: 'default', bg: '#21262d', border: '#30363d' },
    { id: 'red',     bg: '#5c2b29', border: '#7a3835' },
    { id: 'pink',    bg: '#4a1942', border: '#6e2b64' },
    { id: 'orange',  bg: '#5c3316', border: '#854b22' },
    { id: 'yellow',  bg: '#54480d', border: '#7a6a14' },
    { id: 'green',   bg: '#1e3d1e', border: '#2e5c2e' },
    { id: 'teal',    bg: '#0e3a36', border: '#185a52' },
    { id: 'blue',    bg: '#1a3a5c', border: '#2a5a8c' },
    { id: 'purple',  bg: '#36185c', border: '#5a2e90' },
    { id: 'gray',    bg: '#35393f', border: '#54585f' },
  ],

  async getAll() {
    const { data } = await sb.from('notes').select('*').eq('user_id', currentUser.id).order('created');
    return data || [];
  },

  _getColor(id) { return this.COLORS.find(c => c.id === id) || this.COLORS[0]; },

  async render() {
    const q     = this._q.toLowerCase();
    const notes = await this.getAll();
    const filtered = q
      ? notes.filter(n => (n.title||'').toLowerCase().includes(q) || (n.body||'').toLowerCase().includes(q))
      : notes;
    const el = document.getElementById('notes-grid');
    if (!filtered.length) {
      el.innerHTML = `<div class="empty-state" style="column-span:all">
        <div class="empty-state-icon">📝</div>
        <p>${!notes.length ? 'No notes yet — add one!' : 'No results.'}</p>
      </div>`;
      return;
    }
    el.innerHTML = filtered.slice().reverse().map(n => {
      const c = this._getColor(n.color);
      return `<div class="note-card" style="background:${c.bg};border-color:${c.border}" onclick="Notes.openEdit('${n.id}')">
        ${n.title ? `<div class="note-card-title">${esc(n.title)}</div>` : ''}
        <div class="note-card-body">${esc(n.body||'').replace(/\n/g,'<br>')}</div>
        <div class="note-card-footer">
          <span class="note-card-date">${fmtShort(new Date(n.updated||n.created))}</span>
          <button class="note-card-del" onclick="Notes.delete('${n.id}',event)" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
              <polyline points="3,6 5,6 21,6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
            </svg>
          </button>
        </div>
      </div>`;
    }).join('');
  },

  search(q) { this._q = q; this.render(); },

  _colorPicker(selected) {
    return `<div class="note-color-picker">${
      this.COLORS.map(c =>
        `<button type="button" class="note-color-dot ${c.id === selected ? 'selected' : ''}"
          style="background:${c.bg};border-color:${c.border}"
          onclick="Notes._selectColor('${c.id}')" data-color="${c.id}" title="${c.id}"></button>`
      ).join('')
    }</div>`;
  },

  _selectColor(id) {
    document.querySelectorAll('.note-color-dot').forEach(d => d.classList.remove('selected'));
    document.querySelector(`.note-color-dot[data-color="${id}"]`)?.classList.add('selected');
    document.getElementById('note-color-input').value = id;
    const c = this._getColor(id);
    const modal = document.querySelector('#modal-overlay .modal');
    if (modal) { modal.style.background = c.bg; modal.style.borderColor = c.border; }
  },

  _applyModalColor(colorId) {
    const c = this._getColor(colorId);
    setTimeout(() => {
      const modal = document.querySelector('#modal-overlay .modal');
      if (modal) { modal.style.background = c.bg; modal.style.borderColor = c.border; }
    }, 10);
  },

  openAdd() {
    Modal.show('New Note', `
      <div class="form-group">
        <input class="form-input" id="note-title" placeholder="Title (optional)" style="font-size:15px;font-weight:600;background:transparent;border-color:rgba(255,255,255,0.15)">
      </div>
      <div class="form-group">
        <textarea class="form-textarea" id="note-body" placeholder="Write your note..." rows="7" style="background:transparent;border-color:rgba(255,255,255,0.15);resize:vertical"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Color</label>
        ${this._colorPicker('default')}
        <input type="hidden" id="note-color-input" value="default">
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="Notes.add()">Save Note</button>
      </div>`);
    this._applyModalColor('default');
  },

  async add() {
    const body = document.getElementById('note-body').value.trim();
    if (!body) { toast('Please write something!', 'error'); return; }
    await sb.from('notes').insert({
      id: uid(),
      user_id: currentUser.id,
      title: document.getElementById('note-title').value.trim(),
      body,
      color: document.getElementById('note-color-input').value || 'default',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    });
    const modal = document.querySelector('#modal-overlay .modal');
    if (modal) { modal.style.background = ''; modal.style.borderColor = ''; }
    Modal.close();
    this.render();
    toast('Note saved!');
  },

  async openEdit(id) {
    const { data: note } = await sb.from('notes').select('*').eq('id', id).single();
    if (!note) return;
    const colorId = note.color || 'default';
    Modal.show('Edit Note', `
      <div class="form-group">
        <input class="form-input" id="note-title" placeholder="Title (optional)" value="${esc(note.title||'')}"
          style="font-size:15px;font-weight:600;background:transparent;border-color:rgba(255,255,255,0.15)">
      </div>
      <div class="form-group">
        <textarea class="form-textarea" id="note-body" rows="7" style="background:transparent;border-color:rgba(255,255,255,0.15);resize:vertical">${esc(note.body||'')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Color</label>
        ${this._colorPicker(colorId)}
        <input type="hidden" id="note-color-input" value="${esc(colorId)}">
      </div>
      <div class="modal-footer">
        <button class="btn btn-danger" style="border:1px solid var(--red);margin-right:auto" onclick="Notes.delete('${note.id}')">Delete</button>
        <button class="btn btn-ghost" onclick="Notes._closeEdit()">Cancel</button>
        <button class="btn btn-primary" onclick="Notes.update('${note.id}')">Save</button>
      </div>`);
    this._applyModalColor(colorId);
  },

  _closeEdit() {
    const modal = document.querySelector('#modal-overlay .modal');
    if (modal) { modal.style.background = ''; modal.style.borderColor = ''; }
    Modal.close();
  },

  async update(id) {
    const body = document.getElementById('note-body').value.trim();
    if (!body) { toast('Please write something!', 'error'); return; }
    await sb.from('notes').update({
      title:   document.getElementById('note-title').value.trim(),
      body,
      color:   document.getElementById('note-color-input').value || 'default',
      updated: new Date().toISOString(),
    }).eq('id', id);
    const modal = document.querySelector('#modal-overlay .modal');
    if (modal) { modal.style.background = ''; modal.style.borderColor = ''; }
    Modal.close();
    this.render();
    toast('Note updated!');
  },

  async delete(id, e) {
    if (e) e.stopPropagation();
    await sb.from('notes').delete().eq('id', id);
    const modal = document.querySelector('#modal-overlay .modal');
    if (modal) { modal.style.background = ''; modal.style.borderColor = ''; }
    Modal.close();
    this.render();
    toast('Note deleted');
  }
};

/* ════════════════════════════════════════════════
   MESSAGES (Supabase Realtime chat)
════════════════════════════════════════════════ */
const Messages = {
  _open: false,
  _pendingImage: null,

  handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = ev => {
          this._resizeImage(ev.target.result, 800).then(compressed => {
            this._pendingImage = compressed;
            document.getElementById('dm-img-thumb').src = compressed;
            document.getElementById('dm-img-preview').style.display = '';
          });
        };
        reader.readAsDataURL(item.getAsFile());
        break;
      }
    }
  },

  clearImage() {
    this._pendingImage = null;
    document.getElementById('dm-img-preview').style.display = 'none';
    document.getElementById('dm-img-thumb').src = '';
  },

  _resizeImage(dataUrl, maxW) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const c = document.createElement('canvas');
        c.width = img.width * scale; c.height = img.height * scale;
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.src = dataUrl;
    });
  },

  async getConversation(otherId) {
    const { data } = await sb.from('messages').select('*')
      .or(`and(from_user_id.eq.${currentUser.id},to_user_id.eq.${otherId}),and(from_user_id.eq.${otherId},to_user_id.eq.${currentUser.id})`)
      .order('created');
    return data || [];
  },

  async totalUnread() {
    const { count } = await sb.from('messages').select('*', { count: 'exact', head: true })
      .eq('to_user_id', currentUser.id).eq('read', false);
    return count || 0;
  },

  async updateBadge() {
    const count = await this.totalUnread();
    const badge = document.getElementById('chat-bubble-badge');
    if (!badge) return;
    if (count > 0) { badge.textContent = count; badge.style.display = ''; }
    else badge.style.display = 'none';
  },

  subscribeRealtime() {
    if (_msgChannel) sb.removeChannel(_msgChannel);
    _msgChannel = sb.channel(`msg-${currentUser.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `to_user_id=eq.${currentUser.id}`
      }, payload => {
        this.updateBadge();
        if (this._open && currentChatId === payload.new.from_user_id) {
          this._renderConv(currentChatId);
        }
      })
      .subscribe();
  },

  togglePanel() {
    this._open = !this._open;
    const panel = document.getElementById('chat-panel');
    if (this._open) {
      panel.classList.add('open');
      this._showContacts();
    } else {
      panel.classList.remove('open');
      currentChatId = null;
    }
  },

  _showContacts() {
    document.getElementById('dm-conv-view').style.display = 'none';
    document.getElementById('dm-contacts').style.display = '';
    document.getElementById('chat-back-btn').style.display = 'none';
    document.getElementById('chat-panel-title').textContent = 'Messages';
    this._renderContacts();
  },

  backToContacts() {
    currentChatId = null;
    this._showContacts();
  },

  async _renderContacts() {
    await Users.getAll(); // refresh user cache
    const others   = _cachedUsers.filter(u => u.id !== currentUser.id);
    const contacts = document.getElementById('dm-contacts');

    if (others.length === 0) {
      contacts.innerHTML = `<div class="chat-empty-contacts">
        <div style="font-size:32px;margin-bottom:8px">💬</div>
        <p>No other users yet.</p>
        <p style="font-size:11px;margin-top:4px">Add a user from the login page.</p>
      </div>`;
      return;
    }

    const items = await Promise.all(others.map(async u => {
      const pic    = Avatar.get(u.id);
      const grad   = getUserGradient(u.id);
      const { count: unread } = await sb.from('messages').select('*', { count: 'exact', head: true })
        .eq('from_user_id', u.id).eq('to_user_id', currentUser.id).eq('read', false);
      const msgs    = await this.getConversation(u.id);
      const lastMsg = msgs[msgs.length - 1];
      const preview = lastMsg ? (lastMsg.from_user_id === currentUser.id ? 'You: ' : '') + lastMsg.text : 'Start a conversation';
      return `<div class="dm-contact" onclick="Messages.openChat('${u.id}')">
        <div class="dm-contact-av" style="${pic?'':'background:linear-gradient('+grad+')'}">
          ${pic ? `<img src="${pic}" alt="${esc(u.name)}">` : getInitials(u.name)}
          ${unread ? `<span class="dm-contact-dot"></span>` : ''}
        </div>
        <div class="dm-contact-info">
          <div class="dm-contact-name">${esc(u.name)}${unread ? ` <span class="dm-unread-badge">${unread}</span>` : ''}</div>
          <div class="dm-contact-preview">${esc(preview)}</div>
        </div>
      </div>`;
    }));
    contacts.innerHTML = items.join('');

    if (others.length === 1) this.openChat(others[0].id);
  },

  async openChat(otherId) {
    currentChatId = otherId;
    const other = _cachedUsers.find(u => u.id === otherId);
    document.getElementById('dm-contacts').style.display = 'none';
    const convView = document.getElementById('dm-conv-view');
    convView.style.display = 'flex';
    document.getElementById('chat-back-btn').style.display = '';
    document.getElementById('chat-panel-title').textContent = other ? esc(other.name) : 'Chat';
    await this._renderConv(otherId);
    setTimeout(() => document.getElementById('dm-input')?.focus(), 50);
  },

  async _renderConv(otherId) {
    const msgs  = await this.getConversation(otherId);
    const other = _cachedUsers.find(u => u.id === otherId);
    const el    = document.getElementById('dm-messages');
    if (!el) return;

    if (!msgs.length) {
      const pic  = Avatar.get(otherId);
      const grad = getUserGradient(otherId);
      el.innerHTML = `<div class="ai-welcome" style="padding:24px 16px">
        <div class="dm-contact-av" style="width:52px;height:52px;font-size:16px;margin:0 auto 10px;${pic?'':'background:linear-gradient('+grad+')'}">${pic?`<img src="${pic}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`:getInitials(other.name)}</div>
        <h3 style="font-size:15px">${esc(other.name)}</h3>
        <p style="font-size:12px">Say hi! Start your conversation.</p>
      </div>`;
    } else {
      let html = '', lastDate = '';
      msgs.forEach(m => {
        const isMine     = m.from_user_id === currentUser.id;
        const senderPic  = isMine ? Avatar.get(currentUser.id) : Avatar.get(otherId);
        const senderGrad = isMine ? getUserGradient(currentUser.id) : getUserGradient(otherId);
        const senderInit = isMine ? getInitials(currentUser.name) : getInitials(other.name);
        const senderName = isMine ? currentUser.name : other.name;
        const d       = new Date(m.created);
        const dateStr = d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
        const time    = d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
        if (dateStr !== lastDate) { html += `<div class="dm-date-divider">${dateStr}</div>`; lastDate = dateStr; }
        html += `<div class="dm-msg ${isMine?'mine':'theirs'}">
          <div class="dm-avatar" style="${senderPic?'':'background:linear-gradient('+senderGrad+')'}">
            ${senderPic?`<img src="${senderPic}" alt="${esc(senderName)}">`:senderInit}
          </div>
          <div class="dm-bubble-wrap">
            <div class="dm-bubble">
              ${m.image ? `<img src="${m.image}" style="max-width:220px;max-height:220px;border-radius:8px;display:block;margin-bottom:${m.text?'6px':'0'}" onclick="Messages._viewImg(this.src)">` : ''}
              ${m.text ? esc(m.text) : ''}
            </div>
            <div class="dm-time">${time}</div>
          </div>
        </div>`;
      });
      el.innerHTML = html;
      el.scrollTop = el.scrollHeight;
    }

    // Mark as read
    await sb.from('messages').update({ read: true })
      .eq('from_user_id', otherId).eq('to_user_id', currentUser.id).eq('read', false);
    this.updateBadge();
  },

  async send() {
    if (!currentChatId) return;
    const input = document.getElementById('dm-input');
    const text  = input.value.trim();
    if (!text && !this._pendingImage) return;
    input.value = '';
    const image = this._pendingImage || null;
    this.clearImage();
    await sb.from('messages').insert({
      id: uid(),
      from_user_id: currentUser.id,
      to_user_id: currentChatId,
      text: text || '',
      image,
      read: false,
      created: new Date().toISOString(),
    });
    await this._renderConv(currentChatId);
  },

  keydown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } },

  _viewImg(src) {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
    ov.innerHTML = `<img src="${src}" style="max-width:90vw;max-height:90vh;border-radius:10px;box-shadow:0 8px 40px rgba(0,0,0,.6)">`;
    ov.onclick = () => ov.remove();
    document.body.appendChild(ov);
  }
};

// Periodic badge refresh as Realtime fallback
setInterval(() => { if (currentUser) Messages.updateBadge(); }, 10000);

/* ════════════════════════════════════════════════
   AI CHAT
════════════════════════════════════════════════ */
const AIChat = {
  _msgs: [], _busy: false,

  getWebhook: () => localStorage.getItem('oppstrack_n8n_webhook') || '',
  saveWebhook: u => localStorage.setItem('oppstrack_n8n_webhook', u.trim()),

  init() {
    const saved = JSON.parse(localStorage.getItem(`osd_${currentUser.id}_ai-messages`) || 'null');
    if (saved?.length > 0) this._msgs = saved;
    this._renderAll();
  },

  _renderAll() {
    const el      = document.getElementById('ai-messages');
    const webhook = this.getWebhook();
    if (!webhook) { el.innerHTML = this._setupPrompt(); return; }
    if (!this._msgs.length) {
      el.innerHTML = `<div class="ai-welcome"><div class="ai-logo">🦞</div><h3>SideKick</h3>
        <p>Ask me anything!</p>
        <button class="btn btn-ghost btn-sm" style="margin-top:12px" onclick="AIChat.openSettings()">⚙ Change webhook URL</button></div>`;
      return;
    }
    el.innerHTML = this._msgs.map(m => this._bubble(m.role, m.content)).join('');
    el.scrollTop = el.scrollHeight;
  },

  _setupPrompt() {
    return `<div class="ai-welcome"><div class="ai-logo">⚙️</div><h3>Connect your n8n Webhook</h3>
      <p style="margin-bottom:16px">Paste your webhook URL. Your Gemini key stays safely in n8n.</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;max-width:480px;margin:0 auto">
        <input id="webhook-url-input" class="form-input" placeholder="https://your-n8n.com/webhook/ai-chat"
          style="flex:1;min-width:260px" value="${esc(this.getWebhook())}">
        <button class="btn btn-primary" onclick="AIChat.saveWebhookFromInput()">Save</button>
      </div></div>`;
  },

  saveWebhookFromInput() {
    const v = document.getElementById('webhook-url-input')?.value?.trim();
    if (!v) { toast('Enter a URL', 'error'); return; }
    this.saveWebhook(v); toast('Webhook saved!'); this._renderAll();
  },

  openSettings() {
    Modal.show('n8n Webhook', `
      <div class="form-group"><label class="form-label">Webhook URL</label>
        <input class="form-input" id="wb-url" value="${esc(this.getWebhook())}" placeholder="https://...">
        <p style="font-size:12px;color:var(--text2);margin-top:6px">Stored in browser only. Gemini API key stays in n8n.</p></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="Modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="AIChat.saveWebhookFromModal()">Save</button>
      </div>`);
  },

  saveWebhookFromModal() {
    const v = document.getElementById('wb-url')?.value?.trim();
    if (!v) { toast('Enter a URL', 'error'); return; }
    this.saveWebhook(v); Modal.close(); toast('Webhook updated!'); this._renderAll();
  },

  _bubble(role, content) {
    const init = getInitials(currentUser.name);
    const av   = role === 'user' ? `<div class="msg-avatar">${init}</div>` : `<div class="msg-avatar">🤖</div>`;
    const html = role === 'assistant' ? this._md(content) : `<p>${esc(content)}</p>`;
    return `<div class="msg ${role}"><div class="msg-content">${html}</div>${av}</div>`;
  },

  _md(text) {
    const t = typeof text === 'string' ? text : JSON.stringify(text, null, 2);
    return t
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/```([\s\S]*?)```/g,'<pre>$1</pre>')
      .replace(/`([^`]+)`/g,'<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/^#{1,3}\s(.+)/gm,'<strong>$1</strong>')
      .replace(/^\s*[-*]\s(.+)/gm,'<li>$1</li>')
      .replace(/\n\n/g,'</p><p>').replace(/^(?!<[a-z])(.+)$/gm,'<p>$1</p>').replace(/<p><\/p>/g,'');
  },

  async send() {
    if (this._busy) return;
    const wh = this.getWebhook();
    if (!wh) { toast('Set up your webhook first', 'error'); this._renderAll(); return; }
    const input = document.getElementById('ai-input');
    const text  = input.value.trim();
    if (!text) return;
    input.value = '';
    this._msgs.push({ role: 'user', content: text });
    this._renderAll();
    this._busy = true;
    document.getElementById('ai-send-btn').disabled = true;
    const el = document.getElementById('ai-messages');
    el.insertAdjacentHTML('beforeend', '<div class="msg ai msg-typing"><div class="msg-content"><p>Thinking...</p></div><div class="msg-avatar">🤖</div></div>');
    el.scrollTop = el.scrollHeight;
    try {
      const res  = await fetch(wh, { method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ messages: this._msgs, user: currentUser.name }) });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const data = await res.json();
      const d = Array.isArray(data) ? data[0] : data;
      const reply =
        d?.content?.parts?.[0]?.text ||
        d?.output || d?.text || d?.response ||
        (typeof d?.content === 'string' ? d.content : null) ||
        JSON.stringify(data);
      this._msgs.push({ role: 'assistant', content: reply });
      localStorage.setItem(`osd_${currentUser.id}_ai-messages`, JSON.stringify(this._msgs.slice(-50)));
    } catch(err) {
      this._msgs.push({ role:'assistant', content:`⚠️ Error: **${err.message}**\n\nCheck your n8n webhook URL and that the workflow is active.` });
    }
    this._busy = false;
    document.getElementById('ai-send-btn').disabled = false;
    this._renderAll();
  },

  clear() { this._msgs = []; localStorage.removeItem(`osd_${currentUser.id}_ai-messages`); this._renderAll(); },
  keydown(e) { if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();this.send();} }
};

/* ════════════════════════════════════════════════
   CALCULATOR
════════════════════════════════════════════════ */
const Calc = {
  _cur:'0', _prev:null, _op:null, _reset:false, _history:[],
  _sym(){ return {'+':'+','-':'−','*':'×','/':'÷'}[this._op]||''; },
  _display(){ document.getElementById('calc-num').textContent=this._cur; document.getElementById('calc-expr').textContent=this._prev!==null?`${this._prev} ${this._sym()}`:''; },
  num(d){ if(this._reset){this._cur=d;this._reset=false;}else this._cur=this._cur==='0'?d:this._cur+d; if(this._cur.length>12)this._cur=this._cur.slice(0,12); this._display(); },
  dot(){ if(this._reset){this._cur='0.';this._reset=false;}else if(!this._cur.includes('.'))this._cur+='.'; this._display(); },
  op(o){ if(this._op&&!this._reset)this.equals(true); this._prev=parseFloat(this._cur);this._op=o;this._reset=true;this._display(); },
  equals(chain=false){
    if(this._op===null||this._prev===null)return;
    const a=this._prev,b=parseFloat(this._cur);
    let r; switch(this._op){case'+':r=a+b;break;case'-':r=a-b;break;case'*':r=a*b;break;case'/':r=b===0?'Error':a/b;break;}
    if(!chain){this._history.unshift(`${a} ${this._sym()} ${b} = ${r}`);this._history=this._history.slice(0,20);this._renderHistory();}
    this._cur=r==='Error'?'Error':String(parseFloat(r.toFixed(10)));this._op=null;this._prev=null;this._reset=true;this._display();
  },
  clear(){ this._cur='0';this._op=null;this._prev=null;this._reset=false;this._display(); },
  toggleSign(){ this._cur=String(-parseFloat(this._cur));this._display(); },
  percent(){ this._cur=String(parseFloat(this._cur)/100);this._display(); },
  _renderHistory(){ document.getElementById('calc-history-list').innerHTML=this._history.map(h=>{const p=h.split('=');return`<div class="hist-item">${esc(p[0])}= <span>${esc(p[1])}</span></div>`;}).join(''); },
  clearHistory(){ this._history=[];this._renderHistory(); }
};

document.addEventListener('keydown', e => {
  if (currentSection!=='calculator') return;
  if(e.key>='0'&&e.key<='9') Calc.num(e.key);
  else if(e.key==='.') Calc.dot();
  else if(e.key==='+') Calc.op('+');
  else if(e.key==='-') Calc.op('-');
  else if(e.key==='*') Calc.op('*');
  else if(e.key==='/'){e.preventDefault();Calc.op('/');}
  else if(e.key==='Enter'||e.key==='=') Calc.equals();
  else if(e.key==='Backspace'){if(Calc._cur.length>1)Calc._cur=Calc._cur.slice(0,-1);else Calc._cur='0';Calc._display();}
  else if(e.key==='Escape'||e.key==='c'||e.key==='C') Calc.clear();
});

/* ════════════════════════════════════════════════
   PIN DIGIT INPUTS — keyboard nav
════════════════════════════════════════════════ */
function initPinDigits(containerId, onComplete) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.addEventListener('keydown', e => {
    const all = Array.from(container.querySelectorAll('.pin-digit'));
    const idx = all.indexOf(e.target);
    if (idx === -1) return;
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (e.target.value) { e.target.value = ''; e.target.classList.remove('filled'); }
      else if (idx > 0)   { all[idx-1].value = ''; all[idx-1].classList.remove('filled'); all[idx-1].focus(); }
    } else if (e.key === 'ArrowLeft' && idx>0)              all[idx-1].focus();
    else if (e.key === 'ArrowRight' && idx<all.length-1)   all[idx+1].focus();
    else if (e.key === 'Enter' && onComplete)               onComplete();
  });

  container.addEventListener('input', e => {
    const all = Array.from(container.querySelectorAll('.pin-digit'));
    const idx = all.indexOf(e.target);
    if (idx === -1) return;
    e.target.value = e.target.value.replace(/\D/g, '').slice(-1);
    if (e.target.value) {
      e.target.classList.add('filled');
      if (idx < all.length-1) all[idx+1].focus();
      if (all.every(d => d.value) && onComplete) onComplete();
    } else e.target.classList.remove('filled');
  });
}

/* ════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  initDarkMode();
  ParticlesBg.init();
  await renderLoginPage();

  initPinDigits('pin-digits',     () => PinAuth.verify());
  initPinDigits('reg-pin-digits', null);
});

/* ════════════════════════════════════════════════
   UTILITIES
════════════════════════════════════════════════ */
function uid()  { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function fmtShort(d){ return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
function fmtFull(d) { return d.toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}); }
function fmtBytes(b){ if(b<1024)return`${b} B`;if(b<1048576)return`${(b/1024).toFixed(1)} KB`;return`${(b/1048576).toFixed(1)} MB`; }
