const GOOGLE_API_KEY = 'AIzaSyAapAvZFMejE-IdJQuo93WG7thoE5wqsM4';

// Initialize on tab switch
window.loadClients = async () => {
    const clientList = document.getElementById('client-list');
    const { data, error } = await sb.from('sunum_clients').select('*').order('created_at', { ascending: false });
    if (error) return;
    if (data && data.length === 0) {
        clientList.innerHTML = `<div style="padding: 3rem; grid-column: 1/-1; text-align: center;"><p style="color: var(--text-secondary); margin-bottom: 1rem;">Henüz müşteri eklenmemiş.</p><button class="btn-primary-sunum" onclick="openClientModal()">İlk Müşteriyi Ekle</button></div>`;
        return;
    }
    clientList.innerHTML = data.map(client => `
        <div class="client-card">
            <div class="client-info-box">
                <div class="client-avatar">
                    <img src="https://ui-avatars.com/api/?name=${encodeURIComponent(client.name)}&background=a855f7&color=fff" alt="">
                </div>
                <div class="client-name-wrap">
                    <h3>${client.name}</h3>
                    <p style="color: rgba(255,255,255,0.4); font-size: 0.8rem; margin-top: 4px;">${client.subtitle || 'Sosyal Medya Sunumu'}</p>
                </div>
            </div>
            
            <div class="client-actions">
                <button onclick="managePosts('${client.id}')" class="action-sq-btn" title="İçerikleri Yönet">
                    <i data-lucide="layout" style="width: 18px;"></i>
                </button>
                <a href="${window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? `presentation.html?slug=${client.slug}` : `/${client.slug}`}" target="_blank" class="action-sq-btn" title="Sunumu Aç">
                    <i data-lucide="external-link" style="width: 18px;"></i>
                </a>
                <button onclick="editClient('${client.id}')" class="action-sq-btn" title="Düzenle">
                    <i data-lucide="edit-2" style="width: 18px;"></i>
                </button>
                <button onclick="deleteClient('${client.id}')" class="action-sq-btn" style="color: #ff453a;" title="Sil">
                    <i data-lucide="trash-2" style="width: 18px;"></i>
                </button>
            </div>
        </div>
    `).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
};

let editingClientId = null;
window.openClientModal = () => { 
    editingClientId = null; 
    document.getElementById('client-modal-title').textContent = 'Yeni Müşteri'; 
    document.getElementById('client-name').value = ''; 
    document.getElementById('client-slug').value = ''; 
    document.getElementById('client-subtitle').value = ''; 
    document.getElementById('client-modal').classList.add('active'); 
};

window.editClient = async (clientId) => {
    const { data: client } = await sb.from('sunum_clients').select('*').eq('id', clientId).single();
    if (!client) return;
    editingClientId = clientId;
    document.getElementById('client-modal-title').textContent = 'Müşteriyi Düzenle';
    document.getElementById('client-name').value = client.name;
    document.getElementById('client-slug').value = client.slug;
    document.getElementById('client-subtitle').value = client.subtitle || '';
    document.getElementById('client-modal').classList.add('active');
};

window.closeModal = (id) => document.getElementById(id).classList.remove('active');

window.saveClient = async () => {
    const name = document.getElementById('client-name').value;
    const slug = document.getElementById('client-slug').value;
    const subtitle = document.getElementById('client-subtitle').value || 'Özelleştirilmiş İçerik Sunumu';
    if (!name || !slug) { alert('Lütfen tüm alanları doldurun.'); return; }
    const clientData = { name, slug, subtitle };
    if (editingClientId) clientData.id = editingClientId;
    const { error } = await sb.from('sunum_clients').upsert([clientData]);
    if (error) { alert('Hata: ' + error.message); } else { document.getElementById('client-modal').classList.remove('active'); loadClients(); }
};

window.deleteClient = async (clientId) => {
    if (!confirm('Bu müşteriyi ve tüm sunum içeriklerini silmek istediğinize emin misiniz?')) return;
    await sb.from('sunum_posts').delete().eq('client_id', clientId);
    await sb.from('sunum_clients').delete().eq('id', clientId);
    loadClients();
};

let currentClientId = null;
window.managePosts = async (clientId) => {
    currentClientId = clientId;
    document.getElementById('post-modal').classList.add('active');
    setupDragAndDrop();
    loadExistingPosts(clientId);
};

function setupDragAndDrop() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('post-file');
    dropZone.onclick = () => fileInput.click();
    dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); };
    dropZone.ondragleave = () => dropZone.classList.remove('drag-over');
    dropZone.ondrop = (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); handleFiles(e.dataTransfer.files); };
    fileInput.onchange = () => handleFiles(fileInput.files);
}

async function handleFiles(files) {
    if (!currentClientId) return;
    const progress = document.getElementById('upload-progress');
    const isMerge = document.getElementById('merge-carousel').checked;
    progress.style.display = 'block';
    const selectedFiles = Array.from(files);
    
    const { data: posts } = await sb.from('sunum_posts').select('*').eq('client_id', currentClientId).order('order');
    const existingPostsCount = posts ? posts.length : 0;

    if (isMerge && selectedFiles.length > 0) {
        const carouselUrls = [];
        for (const file of selectedFiles) {
            const filePath = `${currentClientId}/${Date.now()}_${file.name}`;
            await sb.storage.from('media').upload(filePath, file);
            const { data: { publicUrl } } = await sb.storage.from('media').getPublicUrl(filePath);
            carouselUrls.push(publicUrl);
        }
        await sb.from('sunum_posts').insert([{
            client_id: currentClientId,
            media_url: carouselUrls[0],
            carousel_data: carouselUrls,
            type: 'carousel',
            order: existingPostsCount
        }]);
    } else {
        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            const filePath = `${currentClientId}/${Date.now()}_${file.name}`;
            await sb.storage.from('media').upload(filePath, file);
            const { data: { publicUrl } } = await sb.storage.from('media').getPublicUrl(filePath);
            await sb.from('sunum_posts').insert([{
                client_id: currentClientId,
                media_url: publicUrl,
                type: file.type.startsWith('video') ? 'video' : 'single',
                order: existingPostsCount + i
            }]);
        }
    }
    progress.style.display = 'none';
    loadExistingPosts(currentClientId);
}

let mainSortable = null;
window.loadExistingPosts = async (clientId) => {
    const container = document.getElementById('existing-posts');
    const { data: posts } = await sb.from('sunum_posts').select('*').eq('client_id', clientId).order('order', { ascending: true });
    
    if (!posts) { container.innerHTML = ''; return; }

    if (mainSortable) {
        mainSortable.destroy();
        mainSortable = null;
    }

    container.innerHTML = posts.map(post => `
        <div class="post-item" data-id="${post.id}" onclick="toggleSelect(this)">
            <div style="position:absolute; top:2px; left:2px; background:rgba(0,0,0,0.5); color:white; padding:2px; border-radius:4px; z-index:5;"><i data-lucide="grip-vertical" style="width: 14px;"></i></div>
            ${post.type === 'video' ? `<video src="${post.media_url}" muted></video>` : post.type === 'carousel' ? `<img src="${post.media_url}"><div style="position:absolute;top:5px;right:30px;color:white;background:rgba(0,0,0,0.5);padding:2px 6px;border-radius:4px;font-size:10px;">Carousel</div><button onclick="event.stopPropagation(); manageCarousel('${post.id}')" style="position:absolute;top:5px;right:50px;background:rgba(0,122,255,0.9);color:white;border:none;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;"><i data-lucide="edit-3" style="width: 12px;"></i></button>` : `<img src="${post.media_url}">`}
            <button onclick="event.stopPropagation(); deletePost('${post.id}')" class="post-item-delete"><i data-lucide="x" style="width: 12px;"></i></button>
            <input type="checkbox" class="post-item-select" onclick="event.stopPropagation(); updateSelection()">
        </div>
    `).join('');
    if (typeof lucide !== 'undefined') lucide.createIcons();
    updateSelection();

    mainSortable = new Sortable(container, {
        animation: 150,
        forceFallback: true,
        ghostClass: 'sortable-ghost',
        onEnd: async () => {
            const items = Array.from(container.querySelectorAll('.post-item'));
            const updates = items.map((item, index) => ({ 
                id: item.dataset.id, 
                order: index 
            }));
            
            for (const update of updates) {
                await sb.from('sunum_posts')
                    .update({ order: update.order })
                    .eq('id', update.id);
            }
        }
    });
};

window.toggleSelect = (el) => {
    const cb = el.querySelector('.post-item-select');
    if (cb) { cb.checked = !cb.checked; updateSelection(); }
};

window.updateSelection = () => {
    const items = document.querySelectorAll('.post-item');
    let selectedCount = 0;
    items.forEach(item => {
        const cb = item.querySelector('.post-item-select');
        if (cb) {
            const isSelected = cb.checked;
            item.classList.toggle('selected', isSelected);
            if (isSelected) selectedCount++;
        }
    });
    const makeBtn = document.getElementById('btn-make-carousel');
    if (makeBtn) makeBtn.style.display = selectedCount > 1 ? 'flex' : 'none';
};

window.makeCarousel = async () => {
    const selectedItems = Array.from(document.querySelectorAll('.post-item.selected'));
    if (selectedItems.length < 2) return;

    const ids = selectedItems.map(item => item.dataset.id);
    const { data: posts } = await sb.from('sunum_posts').select('*').eq('client_id', currentClientId).order('order');
    if (!posts) return;
    const selectedPosts = posts.filter(p => ids.includes(p.id)).sort((a,b) => a.order - b.order);

    const carouselUrls = [];
    selectedPosts.forEach(p => {
        if (p.type === 'carousel') carouselUrls.push(...p.carousel_data);
        else carouselUrls.push(p.media_url);
    });

    await sb.from('sunum_posts').insert([{
        client_id: currentClientId,
        media_url: carouselUrls[0],
        carousel_data: carouselUrls,
        type: 'carousel',
        order: selectedPosts[0].order
    }]);

    for (const id of ids) await sb.from('sunum_posts').delete().eq('id', id);
    loadExistingPosts(currentClientId);
};

window.deletePost = async (postId) => {
    if (!confirm('Bu içeriği silmek istediğinize emin misiniz?')) return;
    await sb.from('sunum_posts').delete().eq('id', postId);
    loadExistingPosts(currentClientId);
};

window.deleteAllPosts = async () => {
    if (!currentClientId) return;
    if (!confirm('Tüm içerikleri silmek istediğinize emin misiniz?')) return;
    await sb.from('sunum_posts').delete().eq('client_id', currentClientId);
    loadExistingPosts(currentClientId);
};

let carouselSortable = null;
let currentEditingCarouselId = null;
window.manageCarousel = async (postId) => {
    currentEditingCarouselId = postId;
    const { data: post } = await sb.from('sunum_posts').select('*').eq('id', postId).single();
    if (!post || !post.carousel_data) return;

    const container = document.getElementById('carousel-items-container');

    if (carouselSortable) {
        carouselSortable.destroy();
        carouselSortable = null;
    }

    container.innerHTML = post.carousel_data.map((url, idx) => `
        <div class="carousel-edit-item" data-url="${url}" style="position:relative; aspect-ratio:1; background:#000; border-radius:8px; overflow:hidden; cursor:grab;">
            ${url.match(/\.(mp4|mov|webm|blob|media)/i) ? `<video src="${url}" muted style="width:100%; height:100%; object-fit:cover;"></video>` : `<img src="${url}" style="width:100%; height:100%; object-fit:cover;">`}
            <div style="position:absolute; top:5px; left:5px; background:rgba(0,0,0,0.5); color:white; width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:10px;">${idx + 1}</div>
        </div>
    `).join('');

    document.getElementById('carousel-modal').classList.add('active');

    carouselSortable = new Sortable(container, {
        animation: 150,
        forceFallback: true
    });
};

window.saveCarouselOrder = async () => {
    const container = document.getElementById('carousel-items-container');
    const items = Array.from(container.querySelectorAll('.carousel-edit-item'));
    const newUrls = items.map(item => item.dataset.url);

    const { error } = await sb.from('sunum_posts').update({ 
        carousel_data: newUrls,
        media_url: newUrls[0] 
    }).eq('id', currentEditingCarouselId);

    if (error) {
        alert('Hata: ' + error.message);
    } else {
        document.getElementById('carousel-modal').classList.remove('active');
        loadExistingPosts(currentClientId);
    }
};

window.importFromDrive = async () => {
    const input = document.getElementById('drive-folder-url').value;
    if (!input) { alert('Lütfen klasör linkini veya ID değerini girin.'); return; }
    
    let folderId = input;
    if (input.includes('/folders/')) {
        folderId = input.split('/folders/')[1].split('?')[0].split('/')[0];
    } else if (input.includes('id=')) {
        folderId = input.split('id=')[1].split('&')[0];
    }

    const progress = document.getElementById('upload-progress');
    const progressText = document.getElementById('progress-text');
    const progressBar = document.getElementById('progress-bar');
    const progressPercent = document.getElementById('progress-percent');
    
    progress.style.display = 'block';
    progressText.textContent = 'Drive klasörü taranıyor...';

    try {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&key=${GOOGLE_API_KEY}&fields=files(id,name,mimeType)&pageSize=100`);
        const data = await response.json();

        if (data.error) throw new Error(data.error.message);
        if (!data.files || data.files.length === 0) throw new Error('Klasör boş veya erişime açık değil.');

        const items = data.files;
        const { data: existingPosts } = await sb.from('sunum_posts').select('id').eq('client_id', currentClientId);
        let currentOrder = existingPosts ? existingPosts.length : 0;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const percent = Math.round(((i + 1) / items.length) * 100);
            progressText.textContent = `İşleniyor: ${i + 1}/${items.length}`;
            progressBar.style.width = percent + '%';
            progressPercent.textContent = percent + '%';

            if (item.mimeType === 'application/vnd.google-apps.folder') {
                const subResponse = await fetch(`https://www.googleapis.com/drive/v3/files?q='${item.id}'+in+parents+and+trashed=false&key=${GOOGLE_API_KEY}&fields=files(id,name,mimeType)&pageSize=50`);
                const subData = await subResponse.json();
                
                if (subData.files && subData.files.length > 0) {
                    const subFiles = subData.files.filter(f => f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/'));
                    if (subFiles.length > 0) {
                        const carouselUrls = subFiles.map(f => {
                            if (f.mimeType.startsWith('image/')) {
                                return `https://drive.google.com/thumbnail?id=${f.id}&sz=w1600`;
                            }
                            return `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media&key=${GOOGLE_API_KEY}`;
                        });

                        await sb.from('sunum_posts').insert([{
                            client_id: currentClientId,
                            media_url: carouselUrls[0],
                            carousel_data: carouselUrls,
                            type: 'carousel',
                            order: currentOrder++
                        }]);
                    }
                }
            } else if (item.mimeType.startsWith('image/') || item.mimeType.startsWith('video/')) {
                let directUrl = item.mimeType.startsWith('image/') 
                    ? `https://drive.google.com/thumbnail?id=${item.id}&sz=w1600`
                    : `https://www.googleapis.com/drive/v3/files/${item.id}?alt=media&key=${GOOGLE_API_KEY}`;

                await sb.from('sunum_posts').insert([{
                    client_id: currentClientId,
                    media_url: directUrl,
                    type: item.mimeType.startsWith('video') ? 'video' : 'single',
                    order: currentOrder++
                }]);
            }
        }

        alert('Tüm içerikler başarıyla aktarıldı.');
        loadExistingPosts(currentClientId);
    } catch (err) {
        alert('Hata: ' + err.message);
    } finally {
        progress.style.display = 'none';
        document.getElementById('drive-folder-url').value = '';
    }
};

// Slug auto-gen
document.addEventListener('input', (e) => {
    if (e.target.id === 'client-name' && !editingClientId) {
        document.getElementById('client-slug').value = e.target.value
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
});
