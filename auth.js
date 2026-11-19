// Jasmin Digital - Unified Secure Auth Module
// Supports real Supabase Auth (JWT + RLS) with PBKDF2-SHA256 fallback & Remember Me
(function () {
    const ADMIN_EMAIL = 'admin@jasmindigital.com';

    // PBKDF2-SHA256 (100,000 iterations) fallback credentials - no plaintext password in source
    const PBKDF2_SALT_B64 = '0URkSCVQcEaImzDijt95ew==';
    const PBKDF2_HASH_HEX = 'cdf02e466f8fd88fc9a7f5bd3dcf92709707288af58abeb9f5ff87b179058565';
    const PBKDF2_ITERATIONS = 100000;

    const STORAGE_KEY = 'jasmin_auth_session_v2';
    const LOCKOUT_KEY = 'jasmin_auth_lockout_v2';
    const REMEMBER_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
    const MAX_ATTEMPTS = 5;
    const LOCKOUT_MS = 30 * 1000; // 30 seconds

    function base64ToBytes(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    function bytesToHex(buffer) {
        return Array.from(new Uint8Array(buffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    function constantTimeEqual(a, b) {
        if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
        let diff = 0;
        for (let i = 0; i < a.length; i++) {
            diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
        }
        return diff === 0;
    }

    async function verifyPbkdf2(password) {
        if (!window.crypto || !window.crypto.subtle) return false;
        try {
            const enc = new TextEncoder();
            const keyMaterial = await crypto.subtle.importKey(
                'raw',
                enc.encode(password),
                { name: 'PBKDF2' },
                false,
                ['deriveBits']
            );
            const derived = await crypto.subtle.deriveBits(
                {
                    name: 'PBKDF2',
                    salt: base64ToBytes(PBKDF2_SALT_B64),
                    iterations: PBKDF2_ITERATIONS,
                    hash: 'SHA-256'
                },
                keyMaterial,
                256
            );
            return constantTimeEqual(bytesToHex(derived), PBKDF2_HASH_HEX);
        } catch (err) {
            console.error('Hash verification error:', err);
            return false;
        }
    }

    function getLockoutState() {
        try {
            const raw = localStorage.getItem(LOCKOUT_KEY);
            return raw ? JSON.parse(raw) : { attempts: 0, until: 0 };
        } catch {
            return { attempts: 0, until: 0 };
        }
    }

    function setLockoutState(state) {
        try {
            localStorage.setItem(LOCKOUT_KEY, JSON.stringify(state));
        } catch {
            // ignore
        }
    }

    function clearLockout() {
        try {
            localStorage.removeItem(LOCKOUT_KEY);
        } catch {
            // ignore
        }
    }

    function readStoredSession() {
        const sources = [localStorage, sessionStorage];
        for (const store of sources) {
            try {
                const raw = store.getItem(STORAGE_KEY);
                if (!raw) continue;
                const parsed = JSON.parse(raw);
                if (parsed && parsed.verified && parsed.expiresAt > Date.now()) {
                    return parsed;
                }
                store.removeItem(STORAGE_KEY);
            } catch {
                // ignore
            }
        }
        return null;
    }

    function saveStoredSession(remember, mode) {
        const payload = JSON.stringify({
            verified: true,
            mode,
            createdAt: Date.now(),
            expiresAt: Date.now() + REMEMBER_DURATION_MS
        });
        try {
            localStorage.removeItem(STORAGE_KEY);
            sessionStorage.removeItem(STORAGE_KEY);
            if (remember) {
                localStorage.setItem(STORAGE_KEY, payload);
            } else {
                sessionStorage.setItem(STORAGE_KEY, payload);
            }
        } catch {
            // ignore
        }
    }

    async function isAuthenticated() {
        // 1. Check real Supabase Auth session first
        if (window.sb && window.sb.auth) {
            try {
                const { data } = await window.sb.auth.getSession();
                if (data && data.session) return true;
            } catch {
                // fall through
            }
        }
        // 2. Check remembered local/session token
        return Boolean(readStoredSession());
    }

    async function login(password, remember = true) {
        const lock = getLockoutState();
        if (lock.until && lock.until > Date.now()) {
            const secs = Math.ceil((lock.until - Date.now()) / 1000);
            return { ok: false, error: `Çok fazla hatalı deneme. ${secs} saniye bekleyin.` };
        }

        const cleanPass = String(password || '');
        if (!cleanPass) {
            return { ok: false, error: 'Lütfen şifrenizi girin.' };
        }

        // 1. Try real Supabase Auth (JWT + RLS)
        if (window.sb && window.sb.auth) {
            try {
                const { data, error } = await window.sb.auth.signInWithPassword({
                    email: ADMIN_EMAIL,
                    password: cleanPass
                });
                if (!error && data && data.session) {
                    clearLockout();
                    saveStoredSession(remember, 'supabase');
                    return { ok: true, mode: 'supabase' };
                }
            } catch {
                // fall back to PBKDF2 check
            }
        }

        // 2. Fallback: Salted PBKDF2-SHA256 verification
        const valid = await verifyPbkdf2(cleanPass);
        if (valid) {
            clearLockout();
            saveStoredSession(remember, 'local');
            return { ok: true, mode: 'local' };
        }

        // Track failed attempts
        const nextAttempts = (lock.attempts || 0) + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
            setLockoutState({ attempts: 0, until: Date.now() + LOCKOUT_MS });
            return { ok: false, error: 'Çok fazla hatalı deneme. 30 saniye kilitlendi.' };
        }

        setLockoutState({ attempts: nextAttempts, until: 0 });
        return {
            ok: false,
            error: `Hatalı şifre. (${MAX_ATTEMPTS - nextAttempts} deneme hakkı kaldı)`
        };
    }

    async function logout() {
        try {
            localStorage.removeItem(STORAGE_KEY);
            sessionStorage.removeItem(STORAGE_KEY);
            sessionStorage.removeItem('isler_admin_auth');
        } catch {
            // ignore
        }
        if (window.sb && window.sb.auth) {
            try {
                await window.sb.auth.signOut();
            } catch {
                // ignore
            }
        }
    }

    // Modern Password Modal (replaces insecure browser prompt())
    let pendingCallback = null;

    function ensureModal() {
        if (document.getElementById('jasmin-auth-modal')) return;

        const overlay = document.createElement('div');
        overlay.id = 'jasmin-auth-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal-content auth-modal-card">
                <div class="auth-modal-icon">
                    <i data-lucide="shield-check"></i>
                </div>
                <h2>Şifreler Alanı</h2>
                <p class="auth-modal-sub">Devam etmek için erişim şifresini girin.</p>
                <form id="jasmin-auth-form">
                    <div class="auth-input-wrap">
                        <input
                            type="password"
                            id="jasmin-auth-input"
                            placeholder="Şifre"
                            autocomplete="current-password"
                            required
                        />
                        <button type="button" class="auth-eye-btn" id="jasmin-auth-eye" title="Göster/Gizle">
                            <i data-lucide="eye"></i>
                        </button>
                    </div>
                    <label class="auth-remember-row">
                        <input type="checkbox" id="jasmin-auth-remember" checked />
                        <span>Beni hatırla (bu cihazda tekrar sorma)</span>
                    </label>
                    <p id="jasmin-auth-error" class="auth-error-msg" style="display:none;"></p>
                    <div class="modal-actions auth-modal-actions">
                        <button type="button" class="btn-cancel" id="jasmin-auth-cancel">Vazgeç</button>
                        <button type="submit" class="btn-save" id="jasmin-auth-submit">Giriş Yap</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(overlay);

        const form = overlay.querySelector('#jasmin-auth-form');
        const input = overlay.querySelector('#jasmin-auth-input');
        const eyeBtn = overlay.querySelector('#jasmin-auth-eye');
        const rememberEl = overlay.querySelector('#jasmin-auth-remember');
        const errorEl = overlay.querySelector('#jasmin-auth-error');
        const cancelBtn = overlay.querySelector('#jasmin-auth-cancel');
        const submitBtn = overlay.querySelector('#jasmin-auth-submit');

        eyeBtn.addEventListener('click', () => {
            const isHidden = input.type === 'password';
            input.type = isHidden ? 'text' : 'password';
            eyeBtn.innerHTML = `<i data-lucide="${isHidden ? 'eye-off' : 'eye'}"></i>`;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            input.focus();
        });

        cancelBtn.addEventListener('click', closeLoginModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeLoginModal();
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            errorEl.style.display = 'none';
            submitBtn.disabled = true;
            submitBtn.textContent = 'Kontrol ediliyor...';

            const res = await login(input.value, rememberEl.checked);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Giriş Yap';

            if (res.ok) {
                const cb = pendingCallback;
                closeLoginModal();
                if (typeof cb === 'function') cb();
            } else {
                errorEl.textContent = res.error;
                errorEl.style.display = 'block';
                input.value = '';
                input.focus();
            }
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function openLoginModal(onSuccess) {
        ensureModal();
        pendingCallback = onSuccess;
        const overlay = document.getElementById('jasmin-auth-modal');
        const input = document.getElementById('jasmin-auth-input');
        const errorEl = document.getElementById('jasmin-auth-error');

        input.value = '';
        input.type = 'password';
        errorEl.style.display = 'none';
        overlay.classList.add('active');
        setTimeout(() => input.focus(), 60);
    }

    function closeLoginModal() {
        const overlay = document.getElementById('jasmin-auth-modal');
        if (overlay) overlay.classList.remove('active');
        pendingCallback = null;
    }

    window.JasminAuth = {
        isAuthenticated,
        login,
        logout,
        openLoginModal,
        closeLoginModal
    };
})();

