let currentPosts = [];
let currentClient = null;
let isGlobalMuted = true;

// Convert Base64 to Blob URL for maximum performance
const getBlobUrl = (base64) => {
    if (!base64 || !base64.startsWith('data:')) return base64;
    const parts = base64.split(';base64,');
    const contentType = parts[0].split(':')[1];
    const raw = window.atob(parts[1]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for (let i = 0; i < rawLength; ++i) uInt8Array[i] = raw.charCodeAt(i);
    return URL.createObjectURL(new Blob([uInt8Array], { type: contentType }));
};

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    let slug = urlParams.get('slug');

    // If no slug in query param, try to get it from the pathname (for Vercel rewrites)
    if (!slug) {
        const path = window.location.pathname.replace(/^\/|\/$/g, '');
        if (path && path !== 'presentation.html' && path !== 'index.html' && path !== 'admin.html') {
            slug = path;
        }
    }

    if (!slug) {
        const { data: clients } = await sb.from('sunum_clients').select('*').order('created_at', { ascending: true }).limit(1);
        if (clients && clients.length > 0) slug = clients[0].slug;
        else {
            console.error('Müşteri bulunamadı');
            return;
        }
    }

    await loadPresentation(slug);
});

async function loadPresentation(slug) {
    const { data: client, error: clientError } = await sb.from('sunum_clients').select('*').eq('slug', slug).single();
    if (clientError || !client) return;
    currentClient = client;

    document.getElementById('client-name-display').textContent = client.name;
    document.getElementById('post-count').textContent = client.subtitle || 'Özelleştirilmiş İçerik Sunumu';

    const { data: posts, error: postsError } = await sb.from('sunum_posts').select('*').eq('client_id', client.id).order('order', { ascending: true });
    if (postsError || !posts) return;

    // Pre-process media URLs for performance
    currentPosts = posts.map(p => ({
        ...p,
        media_url: getBlobUrl(p.media_url),
        carousel_data: p.carousel_data ? p.carousel_data.map(url => getBlobUrl(url)) : []
    }));

    renderViews(currentPosts);
}

// Ultra-fast video toggle
window.toggleVideo = (e, el) => {
    e.preventDefault();
    e.stopPropagation();

    const container = el.parentElement;
    let overlay = container.querySelector('.video-overlay');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'video-overlay';
        container.appendChild(overlay);
    }

    if (el.paused) {
        el.play();
        overlay.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32" fill="white"><path d="M8 5v14l11-7z"/></svg>';
    } else {
        el.pause();
        overlay.innerHTML = '<svg viewBox="0 0 24 24" width="32" height="32" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
    }

    overlay.classList.add('show');
    setTimeout(() => overlay.classList.remove('show'), 800);
};

window.toggleGlobalMute = (e) => {
    if (e) {
        e.preventDefault();
        e.stopPropagation();
    }

    isGlobalMuted = !isGlobalMuted;

    // Update all video elements
    const allVideos = document.querySelectorAll('video');
    allVideos.forEach(v => {
        v.muted = isGlobalMuted;
    });

    // Update all volume buttons UI
    const allVolumeBtns = document.querySelectorAll('.volume-btn');
    allVolumeBtns.forEach(btn => {
        btn.classList.toggle('muted', isGlobalMuted);
    });
};

function renderViews(posts) {
    const gridView = document.getElementById('grid-view');
    const flowView = document.getElementById('flow-view');

    gridView.innerHTML = posts.map((post, index) => `
        <div class="grid-item ${post.type === 'reel' ? 'reel' : ''} ${post.type === 'carousel' ? 'carousel' : ''}" 
             onclick="openLightbox(${index}, this)">
            ${post.type === 'reel' || post.type === 'video' ? `
                <video src="${post.media_url}" muted loop></video>
                <div class="badge-icon"><i data-lucide="play" style="width: 14px; fill: white;"></i></div>
            ` : post.type === 'carousel' ? `
                <img src="${post.media_url}" alt="">
                <div class="badge-icon"><i data-lucide="layers" style="width: 14px;"></i></div>
            ` : `<img src="${post.media_url}" alt="">`}
        </div>
    `).join('');

    const username = currentClient ? currentClient.slug.replace(/-/g, '').toLowerCase() : 'youraccount';

    flowView.innerHTML = posts.map((post, postIdx) => {
        const headerHTML = `<div class="post-header"><div class="post-user-info"><div class="username">${username} <span class="verified-badge"><i data-lucide="badge-check" style="width: 14px; height: 14px; fill: #0095f6; color: white;"></i></span></div></div><div class="action-btn"><i data-lucide="more-horizontal"></i></div></div>`;
        const actionsHTML = `<div class="post-actions"><div class="action-left"><button class="action-btn heart"><i data-lucide="heart"></i></button><button class="action-btn"><i data-lucide="message-circle"></i></button><button class="action-btn"><i data-lucide="send"></i></button></div><button class="action-btn"><i data-lucide="bookmark"></i></button></div>`;

        let mediaHTML = '';
        if (post.type === 'carousel') {
            const items = post.carousel_data || [];
            mediaHTML = `
                <div class="post-media-wrapper carousel-wrapper" style="position: relative;">
                    <div class="carousel-track" onscroll="handleCarouselScroll(this, ${postIdx})">
                        ${items.map(url => `
                            <div class="carousel-slide" style="position: relative;">
                                ${url.match(/\.(mp4|mov|webm|blob|media)/i) ?
                    `<video src="${url}" onpointerdown="toggleVideo(event, this)" ${isGlobalMuted ? 'muted' : ''} loop playsinline></video>
                                     <button class="volume-btn ${isGlobalMuted ? 'muted' : ''}" onclick="toggleGlobalMute(event)">
                                        <i data-lucide="volume-2"></i>
                                        <i data-lucide="volume-x"></i>
                                     </button>` :
                    `<img src="${url}" alt="" loading="lazy">`
                }
                            </div>
                        `).join('')}
                    </div>
                    <button class="carousel-nav-btn prev" onclick="scrollCarousel(this, -1)"><i data-lucide="chevron-left"></i></button>
                    <button class="carousel-nav-btn next" onclick="scrollCarousel(this, 1)"><i data-lucide="chevron-right"></i></button>
                </div>
                <div class="carousel-dots" id="dots-${postIdx}">${items.map((_, i) => `<div class="dot ${i === 0 ? 'active' : ''}"></div>`).join('')}</div>
            `;
        } else {
            mediaHTML = `
                <div class="post-media-wrapper">
                    ${post.type === 'reel' || post.type === 'video' ? `
                        <video src="${post.media_url}" onpointerdown="toggleVideo(event, this)" ${isGlobalMuted ? 'muted' : ''} loop playsinline></video>
                        <button class="volume-btn ${isGlobalMuted ? 'muted' : ''}" onclick="toggleGlobalMute(event)">
                            <i data-lucide="volume-2"></i>
                            <i data-lucide="volume-x"></i>
                        </button>
                    ` : `<img src="${post.media_url}" alt="" loading="lazy">`}
                </div>
            `;
        }
        return `<div class="post-card" style="border-bottom: 1px solid #efefef; margin-bottom: 1rem;">${headerHTML}${mediaHTML}${actionsHTML}</div>`;
    }).join('');

    if (typeof lucide !== 'undefined') lucide.createIcons();
    setupScrollAnimation();
}

window.scrollCarousel = (btn, direction) => {
    const track = btn.parentElement.querySelector('.carousel-track');
    const width = track.offsetWidth;
    track.scrollBy({ left: direction * width, behavior: 'smooth' });
};

window.handleCarouselScroll = (el, postIdx) => {
    const scrollLeft = el.scrollLeft;
    const width = el.offsetWidth;
    const activeIndex = Math.round(scrollLeft / width);
    const dotsContainer = document.getElementById(postIdx === 'modal' ? 'dots-modal' : `dots-${postIdx}`);
    if (dotsContainer) {
        const dots = dotsContainer.querySelectorAll('.dot');
        dots.forEach((dot, i) => dot.classList.toggle('active', i === activeIndex));
    }
};

window.switchView = (view) => {
    const gridView = document.getElementById('grid-view');
    const flowView = document.getElementById('flow-view');
    const navFlow = document.getElementById('nav-flow');
    const navGrid = document.getElementById('nav-grid');
    if (view === 'grid') { gridView.style.display = 'grid'; flowView.style.display = 'none'; navGrid.classList.add('active'); navFlow.classList.remove('active'); }
    else { gridView.style.display = 'none'; flowView.style.display = 'block'; navFlow.classList.add('active'); navGrid.classList.remove('active'); }
};

function setupScrollAnimation() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const video = entry.target.querySelector('video');
            if (!video) return;
            if (entry.isIntersecting) {
                video.muted = isGlobalMuted;
                video.play();
            }
            else video.pause();
        });
    }, { threshold: 0.6 });
    document.querySelectorAll('.post-card').forEach(card => observer.observe(card));
}

window.openLightbox = (index, el) => {
    const post = currentPosts[index];
    const modal = document.getElementById('presentation-modal');
    const mediaContent = document.getElementById('modal-media-content');

    mediaContent.style.transition = 'none';
    mediaContent.style.transform = 'none';
    mediaContent.style.opacity = '0';
    mediaContent.style.display = 'flex';
    mediaContent.style.alignItems = 'center';
    mediaContent.style.justifyContent = 'center';
    mediaContent.style.width = '100vw';
    mediaContent.style.height = '100vh';
    modal.classList.add('active');

    if (post.type === 'carousel') {
        const items = post.carousel_data || [];
        mediaContent.innerHTML = `
            <div style="width: 100vw; height: 100vh; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center;">
                <div class="carousel-track" onscroll="handleCarouselScroll(this, 'modal')" style="display: flex; overflow-x: auto; scroll-snap-type: x mandatory; height: 100%; width: 100%;">
                    ${items.map(url => `
                        <div class="carousel-slide" style="min-width: 100vw; height: 100vh; scroll-snap-align: start; display: flex; align-items: center; justify-content: center; background: transparent; position: relative;">
                            ${url.match(/\.(mp4|mov|webm|blob)/i) ?
                `<video src="${url}" class="modal-media-item" onpointerdown="toggleVideo(event, this)" autoplay ${isGlobalMuted ? 'muted' : ''} loop playsinline></video>
                                 <button class="volume-btn ${isGlobalMuted ? 'muted' : ''}" onclick="toggleGlobalMute(event)">
                                    <i data-lucide="volume-2"></i>
                                    <i data-lucide="volume-x"></i>
                                 </button>` :
                `<img src="${url}" class="modal-media-item" alt="">`
            }
                        </div>
                    `).join('')}
                </div>
                <div class="carousel-dots" id="dots-modal" style="position: absolute; bottom: 40px; left: 0; right: 0; pointer-events: none;">${items.map((_, i) => `<div class="dot ${i === 0 ? 'active' : ''}"></div>`).join('')}</div>
            </div>
        `;
    } else if (post.type === 'reel' || post.type === 'video') {
        mediaContent.innerHTML = `
            <div style="position: relative; display: flex; align-items: center; justify-content: center;">
                <video src="${post.media_url}" class="modal-media-item" onpointerdown="toggleVideo(event, this)" autoplay ${isGlobalMuted ? 'muted' : ''} loop></video>
                <button class="volume-btn ${isGlobalMuted ? 'muted' : ''}" onclick="toggleGlobalMute(event)">
                    <i data-lucide="volume-2"></i>
                    <i data-lucide="volume-x"></i>
                </button>
            </div>`;
    } else {
        mediaContent.innerHTML = `<img src="${post.media_url}" class="modal-media-item" alt="">`;
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();

    const rect = el.getBoundingClientRect();
    const startX = (rect.left + rect.width / 2) - (window.innerWidth / 2);
    const startY = (rect.top + rect.height / 2) - (window.innerHeight / 2);
    const scale = rect.width / window.innerWidth;
    mediaContent.style.transform = `translate(${startX}px, ${startY}px) scale(${scale})`;

    requestAnimationFrame(() => {
        setTimeout(() => {
            mediaContent.style.transition = 'transform 0.5s cubic-bezier(0.2, 1, 0.2, 1), opacity 0.3s ease';
            mediaContent.style.transform = 'translate(0, 0) scale(1)';
            mediaContent.style.opacity = '1';
        }, 10);
    });

    modal.onclick = (e) => { if (e.target === modal || e.target.classList.contains('carousel-slide') || e.target.id === 'modal-media-content') closeLightbox(); };
};

window.closeLightbox = () => {
    const modal = document.getElementById('presentation-modal');
    const mediaContent = document.getElementById('modal-media-content');
    modal.classList.remove('active');
    mediaContent.innerHTML = '';
};

// Scroll Progress Logic
window.addEventListener('scroll', () => {
    const winScroll = document.body.scrollTop || document.documentElement.scrollTop;
    const height = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    const scrolled = (winScroll / height) * 100;
    const progressBar = document.getElementById('scroll-progress-bar');
    if (progressBar) progressBar.style.width = scrolled + '%';
});
