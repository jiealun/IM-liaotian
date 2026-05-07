// ===== WebChat - No Auth, with Emoji, Paste Image, Reply =====
const SUPABASE_URL = 'https://hkeqntramugheihuhiwt.supabase.co/';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhrZXFudHJhbXVnaGVpaHVoaXd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MTM1NTQsImV4cCI6MjA5MzA4OTU1NH0.csxbOKhe923FTXjRpnLayDCHGb1L8bfFHLcSqd2FZvQ';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { params: { eventsPerSecond: 10 } }
});

// ===== State =====
let currentUser = null;
let allUsers = [];
let activePeerId = null;
let messages = [];
let unreadCounts = {};
let msgChannel = null;
let userChannel = null;
let replyToMsg = null;  // message being replied to

const $ = (s) => document.querySelector(s);
const STORAGE_KEY = 'webchat_user';

// ===== Emoji Data (image-based using Twemoji CDN) =====
// Using Twemoji - high quality emoji images from Twitter/X
const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/';

// Map: emoji unicode -> twemoji filename (codepoint.png)
const EMOJI_LIST = [
  // Smileys
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😉',
  '😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲',
  '😋','😛','😜','🤪','😝','🤑','🤗','🤭','🫢','🤫',
  '🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒',
  '🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒',
  '🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳',
  '🥸','😎','🤓','🧐','😕','🫤','😟','🙁','😮','😯',
  '😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢',
  '😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤',
  '😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹',
  // Gestures
  '👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌',
  '🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉',
  '👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛',
  '🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','💪','🦾',
  // Hearts & symbols
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
  '❤️‍🔥','💕','💞','💓','💗','💖','💘','💝','💟','💯',
  '💢','💥','💫','💦','🔥','⭐','🌟','✨','🎉','🎊',
];

function emojiToTwemoji(emoji) {
  const codepoints = [...emoji].map(c => c.codePointAt(0).toString(16)).join('-');
  // Remove fe0f variant selector for file lookup
  return codepoints.replace(/-fe0f/g, '');
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  setupEnterForm();
  setupChatUI();
  setupEmojiPicker();
  setupContextMenu();

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const u = JSON.parse(saved);
      if (u.id && u.nickname) enterChat(u.id, u.nickname);
    } catch(e) { localStorage.removeItem(STORAGE_KEY); }
  }
});

// ===== Enter =====
let existingUsers = [];

function setupEnterForm() {
  loadExistingUsers();

  // Create new user form
  $('#enterForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nickname = $('#nicknameInput').value.trim();
    if (!nickname) return;

    // Check if already exists
    const { data: existing } = await sb.from('chat_users')
      .select('*').eq('nickname', nickname).maybeSingle();

    if (existing) {
      $('#enterError').textContent = '该昵称已存在，请直接从上方列表点击进入';
      return;
    }

    const id = crypto.randomUUID();
    const { error } = await sb.from('chat_users').insert({
      id, nickname, is_online: true, last_seen: new Date().toISOString()
    });
    if (error) { $('#enterError').textContent = '创建失败: ' + error.message; return; }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, nickname }));
    enterChat(id, nickname);
  });
}

async function loadExistingUsers() {
  const el = $('#userList');
  try {
    const { data, error } = await sb.from('chat_users').select('*').order('last_seen', { ascending: false });
    if (error) throw error;
    existingUsers = data || [];
    renderUserList();
  } catch (err) {
    console.error('loadExistingUsers error:', err);
    el.innerHTML = `<div class="user-list-empty" style="color:var(--danger)">
      加载失败，请检查 Supabase 配置<br><small>${esc(err.message || String(err))}</small>
    </div>`;
  }
}

function renderUserList() {
  const el = $('#userList');
  if (existingUsers.length === 0) {
    el.innerHTML = '<div class="user-list-empty">还没有用户，在下方创建一个吧</div>';
    return;
  }
  el.innerHTML = existingUsers.map(u => `
    <div class="user-list-item" data-id="${u.id}" data-nickname="${esc(u.nickname)}">
      <div class="ul-avatar" style="background:${strColor(u.nickname)}">${u.nickname.charAt(0).toUpperCase()}</div>
      <span class="ul-name">${esc(u.nickname)}</span>
      <span class="ul-status ${u.is_online ? 'online' : 'offline'}">${u.is_online ? '在线' : '离线'}</span>
    </div>
  `).join('');

  el.querySelectorAll('.user-list-item').forEach(item => {
    item.addEventListener('click', () => {
      const id = item.dataset.id;
      const nickname = item.dataset.nickname;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ id, nickname }));
      enterChat(id, nickname);
    });
  });
}

async function enterChat(id, nickname) {
  currentUser = { id, nickname };
  await sb.from('chat_users').upsert({
    id, nickname, is_online: true, last_seen: new Date().toISOString()
  });

  $('#myNickname').textContent = nickname;
  $('#myAvatar').textContent = nickname.charAt(0).toUpperCase();
  $('#enterScreen').style.display = 'none';
  $('#chatScreen').style.display = 'flex';

  await loadUsers();
  subscribeMessages();
  subscribeUsers();

  setInterval(async () => {
    if (currentUser) {
      await sb.from('chat_users').update({
        is_online: true, last_seen: new Date().toISOString()
      }).eq('id', currentUser.id);
      // Also refresh user list periodically as backup
      await loadUsers();
    }
  }, 30000);
}

// ===== Users =====
async function loadUsers() {
  const { data, error } = await sb.from('chat_users')
    .select('*').neq('id', currentUser.id)
    .order('is_online', { ascending: false })
    .order('last_seen', { ascending: false });

  if (error) { console.error('loadUsers error:', error); toast('加载用户列表失败', 'error'); return; }
  allUsers = data || [];
  console.log('loadUsers: found', allUsers.length, 'users', allUsers.map(u => u.nickname));

  for (const u of allUsers) {
    const { count } = await sb.from('chat_messages')
      .select('*', { count: 'exact', head: true })
      .eq('sender_id', u.id).eq('receiver_id', currentUser.id).eq('is_read', false);
    unreadCounts[u.id] = count || 0;

    const { data: last } = await sb.from('chat_messages')
      .select('content, msg_type, created_at')
      .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${u.id}),and(sender_id.eq.${u.id},receiver_id.eq.${currentUser.id})`)
      .order('created_at', { ascending: false }).limit(1);
    u.lastMsg = last?.[0] ? (last[0].msg_type === 'image' ? '[图片]' : last[0].content) : '';
    u.lastTime = last?.[0]?.created_at || '';
  }
  renderUsers();
  updateFaviconBadge();
}

function renderUsers() {
  const q = $('#searchInput').value.trim().toLowerCase();
  const list = q ? allUsers.filter(u => u.nickname.toLowerCase().includes(q)) : allUsers;
  const on = list.filter(u => u.is_online);
  const off = list.filter(u => !u.is_online);

  const onEl = $('#onlineUsers');
  const offEl = $('#offlineUsers');

  onEl.innerHTML = on.length > 0
    ? on.map(userHtml).join('')
    : '<div style="padding:12px 16px;color:var(--text-muted);font-size:13px;">暂无在线用户</div>';

  const offT = $('#offlineTitle');
  if (off.length > 0) { offT.style.display = 'block'; offEl.innerHTML = off.map(userHtml).join(''); }
  else { offT.style.display = 'none'; offEl.innerHTML = ''; }

  // Bind click events on contact items within sidebar only
  $('#contactList').querySelectorAll('.contact-item').forEach(el => {
    el.addEventListener('click', () => {
      const peerId = el.dataset.id;
      if (peerId) openChat(peerId);
    });
  });
}

function userHtml(u) {
  const unread = unreadCounts[u.id] || 0;
  return `
  <div class="contact-item ${u.id===activePeerId?'active':''}" data-id="${u.id}">
    <div class="contact-avatar">
      <div class="avatar-sm" style="background:${strColor(u.nickname)}">${u.nickname.charAt(0).toUpperCase()}</div>
      <div class="online-dot ${u.is_online?'online':''}"></div>
    </div>
    <div class="contact-info">
      <div class="contact-name">${esc(u.nickname)}</div>
      <div class="contact-last-msg">${esc(u.lastMsg)}</div>
    </div>
    <div class="contact-meta">
      <div class="contact-time">${fmtTime(u.lastTime)}</div>
      ${unread>0?`<div class="unread-badge">${unread>99?'99+':unread}</div>`:''}
    </div>
  </div>`;
}

// ===== Open Chat =====
async function openChat(peerId) {
  activePeerId = peerId;
  const peer = allUsers.find(u => u.id === peerId);
  if (!peer) {
    console.error('openChat: peer not found', peerId, allUsers);
    toast('找不到该用户', 'error');
    return;
  }

  $('#peerNickname').textContent = peer.nickname;
  $('#peerAvatar').textContent = peer.nickname.charAt(0).toUpperCase();
  $('#peerAvatar').style.background = strColor(peer.nickname);
  const st = $('#peerStatus');
  st.textContent = peer.is_online ? '在线' : `最近 ${fmtTime(peer.last_seen)}`;
  st.className = 'peer-status' + (peer.is_online ? ' online' : '');

  $('#chatEmpty').style.display = 'none';
  $('#chatWindow').style.display = 'flex';

  // Mobile: hide sidebar when chat opens
  if (window.innerWidth <= 768) {
    document.querySelector('.sidebar').classList.add('hidden');
  }

  cancelReply();
  await loadMessages(peerId);
  await markRead(peerId);
  unreadCounts[peerId] = 0;
  renderUsers();
  updateFaviconBadge();
  $('#msgInput').focus();
}

// ===== Messages =====
async function loadMessages(peerId) {
  const { data } = await sb.from('chat_messages')
    .select('*')
    .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${peerId}),and(sender_id.eq.${peerId},receiver_id.eq.${currentUser.id})`)
    .order('created_at', { ascending: true })
    .limit(1000);
  messages = data || [];
  renderMessages();
}

function renderMessages() {
  const el = $('#chatMessages');
  let html = '';
  let lastDate = '';

  for (const m of messages) {
    const date = new Date(m.created_at).toLocaleDateString('zh-CN');
    if (date !== lastDate) { html += `<div class="msg-date-divider">${date}</div>`; lastDate = date; }

    const mine = m.sender_id === currentUser.id;
    const time = new Date(m.created_at).toLocaleTimeString('zh-CN', { hour:'2-digit', minute:'2-digit' });

    // Reply reference
    let replyHtml = '';
    if (m.reply_to) {
      const orig = messages.find(x => x.id === m.reply_to);
      if (orig) {
        const preview = orig.msg_type === 'image' ? '[图片]' : (orig.content || '').slice(0, 40);
        replyHtml = `<div class="msg-reply-ref" data-scroll-to="${orig.id}">↩ ${esc(preview)}</div>`;
      }
    }

    // Content
    let contentHtml = '';
    if (m.msg_type === 'image') {
      contentHtml = `<img src="${esc(m.file_url)}" alt="图片" onclick="previewImage('${esc(m.file_url)}')">`;
    } else {
      contentHtml = renderTextWithEmoji(m.content);
    }

    html += `
    <div class="msg-row ${mine?'mine':'peer'}" data-msg-id="${m.id}">
      <div class="msg-bubble-wrap">
        ${replyHtml}
        <div class="msg-bubble">${contentHtml}</div>
      </div>
      <div class="msg-time">${time}</div>
    </div>`;
  }

  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;

  // Click reply refs to scroll
  el.querySelectorAll('.msg-reply-ref').forEach(ref => {
    ref.addEventListener('click', () => {
      const targetId = ref.dataset.scrollTo;
      const target = el.querySelector(`[data-msg-id="${targetId}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.style.background = 'rgba(91,106,191,0.1)';
        setTimeout(() => target.style.background = '', 1500);
      }
    });
  });
}

function renderTextWithEmoji(text) {
  if (!text) return '';
  // Just escape HTML - emojis are native unicode and render naturally
  return esc(text);
}

// ===== Send Text =====
async function sendMessage() {
  const text = $('#msgInput').value.trim();
  if (!text || !activePeerId) return;

  $('#msgInput').value = '';
  autoResize();

  const payload = {
    sender_id: currentUser.id,
    receiver_id: activePeerId,
    content: text,
    msg_type: 'text',
    reply_to: replyToMsg ? replyToMsg.id : null
  };

  const { data, error } = await sb.from('chat_messages').insert(payload).select().single();
  if (error) { toast('发送失败: ' + error.message, 'error'); $('#msgInput').value = text; return; }

  messages.push(data);
  renderMessages();
  cancelReply();
  updatePeerLastMsg(activePeerId, text, data.created_at);
}

// ===== Send Image (from paste or file picker) =====
async function sendImage(file) {
  if (!activePeerId) { toast('请先选择聊天对象', 'info'); return; }
  if (!file.type.startsWith('image/')) { await sendFile(file); return; }

  toast('正在上传图片...', 'info');

  const ext = file.name?.split('.').pop() || 'png';
  const path = `chat/${currentUser.id}/${Date.now()}.${ext}`;

  const { error: upErr } = await sb.storage.from('chat-files').upload(path, file, {
    contentType: file.type, upsert: false
  });

  if (upErr) { toast('上传失败: ' + upErr.message, 'error'); return; }

  const { data: urlData } = sb.storage.from('chat-files').getPublicUrl(path);
  const fileUrl = urlData.publicUrl;

  const payload = {
    sender_id: currentUser.id,
    receiver_id: activePeerId,
    content: '',
    msg_type: 'image',
    file_url: fileUrl,
    file_name: file.name || 'image.png',
    reply_to: replyToMsg ? replyToMsg.id : null
  };

  const { data, error } = await sb.from('chat_messages').insert(payload).select().single();
  if (error) { toast('发送失败: ' + error.message, 'error'); return; }

  messages.push(data);
  renderMessages();
  cancelReply();
  updatePeerLastMsg(activePeerId, '[图片]', data.created_at);
}

async function sendFile(file) {
  toast('正在上传文件...', 'info');

  const path = `chat/${currentUser.id}/${Date.now()}_${file.name}`;
  const { error: upErr } = await sb.storage.from('chat-files').upload(path, file, {
    contentType: file.type, upsert: false
  });
  if (upErr) { toast('上传失败: ' + upErr.message, 'error'); return; }

  const { data: urlData } = sb.storage.from('chat-files').getPublicUrl(path);

  const payload = {
    sender_id: currentUser.id,
    receiver_id: activePeerId,
    content: `📎 ${file.name}`,
    msg_type: 'file',
    file_url: urlData.publicUrl,
    file_name: file.name,
    reply_to: replyToMsg ? replyToMsg.id : null
  };

  const { data, error } = await sb.from('chat_messages').insert(payload).select().single();
  if (error) { toast('发送失败: ' + error.message, 'error'); return; }

  messages.push(data);
  renderMessages();
  cancelReply();
  updatePeerLastMsg(activePeerId, `📎 ${file.name}`, data.created_at);
}

function updatePeerLastMsg(peerId, text, time) {
  const peer = allUsers.find(u => u.id === peerId);
  if (peer) { peer.lastMsg = text; peer.lastTime = time; }
  sortUsers(); renderUsers();
}

async function markRead(peerId) {
  await sb.from('chat_messages').update({ is_read: true })
    .eq('sender_id', peerId).eq('receiver_id', currentUser.id).eq('is_read', false);
}

// ===== Reply =====
function setReply(msg) {
  replyToMsg = msg;
  const preview = msg.msg_type === 'image' ? '[图片]' : (msg.content || '').slice(0, 50);
  $('#replyPreview').textContent = preview;
  $('#replyBar').style.display = 'flex';
  $('#msgInput').focus();
}

function cancelReply() {
  replyToMsg = null;
  $('#replyBar').style.display = 'none';
}

// ===== Context Menu (Right Click) =====
function setupContextMenu() {
  const menu = $('#contextMenu');
  const menuBlank = $('#contextMenuBlank');
  let targetMsg = null;

  function hideMenus() {
    menu.style.display = 'none';
    menuBlank.style.display = 'none';
  }

  document.addEventListener('contextmenu', (e) => {
    const chatArea = e.target.closest('#chatMessages');
    const row = e.target.closest('.msg-row');

    hideMenus();

    if (row) {
      // Right-click on a message
      e.preventDefault();
      const msgId = parseInt(row.dataset.msgId);
      targetMsg = messages.find(m => m.id === msgId);
      if (!targetMsg) return;

      menu.style.display = 'block';
      menu.style.left = Math.min(e.clientX, window.innerWidth - 160) + 'px';
      menu.style.top = Math.min(e.clientY, window.innerHeight - 120) + 'px';

      // Only show withdraw for own messages
      const withdrawEl = $('#ctxWithdraw');
      withdrawEl.style.display = (targetMsg.sender_id === currentUser.id) ? 'block' : 'none';
    } else if (chatArea) {
      // Right-click on blank area in chat
      e.preventDefault();
      if (messages.length === 0) return;
      menuBlank.style.display = 'block';
      menuBlank.style.left = Math.min(e.clientX, window.innerWidth - 200) + 'px';
      menuBlank.style.top = Math.min(e.clientY, window.innerHeight - 60) + 'px';
    }
  });

  document.addEventListener('click', hideMenus);

  $('#ctxReply').addEventListener('click', () => {
    if (targetMsg) setReply(targetMsg);
    hideMenus();
  });

  $('#ctxCopy').addEventListener('click', () => {
    if (targetMsg) {
      const text = targetMsg.msg_type === 'image' ? targetMsg.file_url : targetMsg.content;
      navigator.clipboard.writeText(text).then(() => toast('已复制', 'success'));
    }
    hideMenus();
  });

  // Delete single message
  $('#ctxDelete').addEventListener('click', async () => {
    if (!targetMsg) return;
    hideMenus();
    const { error } = await sb.from('chat_messages').delete().eq('id', targetMsg.id);
    if (error) { toast('删除失败', 'error'); console.error(error); return; }
    messages = messages.filter(m => m.id !== targetMsg.id);
    renderMessages();
    toast('已删除', 'success');
  });

  // Withdraw (recall) my message
  $('#ctxWithdraw').addEventListener('click', async () => {
    if (!targetMsg || targetMsg.sender_id !== currentUser.id) {
      hideMenus();
      toast('只能撤回自己发送的消息', 'info');
      return;
    }
    hideMenus();
    const { error } = await sb.from('chat_messages')
      .update({ content: '[消息已撤回]', msg_type: 'text', file_url: '', file_name: '' })
      .eq('id', targetMsg.id)
      .eq('sender_id', currentUser.id);
    if (error) { toast('撤回失败: ' + error.message, 'error'); return; }
    targetMsg.content = '[消息已撤回]';
    targetMsg.msg_type = 'text';
    targetMsg.file_url = '';
    renderMessages();
    toast('消息已撤回', 'success');
  });

  // Clear all history
  $('#ctxClearAll').addEventListener('click', async () => {
    hideMenus();
    if (!confirm('确定清空全部历史消息？此操作不可撤销。')) return;
    const peer = currentPeer;
    if (!peer) return;
    // Delete all messages between current user and peer
    const { error } = await sb.from('chat_messages')
      .delete()
      .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${peer}),and(sender_id.eq.${peer},receiver_id.eq.${currentUser.id})`);
    if (error) { toast('清空失败', 'error'); console.error(error); return; }
    messages = [];
    renderMessages();
    toast('历史消息已清空', 'success');
  });
}

// ===== Emoji Picker =====
function setupEmojiPicker() {
  const picker = $('#emojiPicker');
  const grid = $('#emojiGrid');

  // Build grid with Twemoji image emojis
  grid.innerHTML = EMOJI_LIST.map(emoji => {
    const code = emojiToTwemoji(emoji);
    const url = `${TWEMOJI_BASE}${code}.png`;
    return `<button class="emoji-item" data-emoji="${emoji}" title="${emoji}">
      <img src="${url}" alt="${emoji}" onerror="this.parentElement.textContent='${emoji}'">
    </button>`;
  }).join('');

  grid.querySelectorAll('.emoji-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = $('#msgInput');
      const emoji = btn.dataset.emoji;
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const val = input.value;
      input.value = val.slice(0, start) + emoji + val.slice(end);
      input.selectionStart = input.selectionEnd = start + emoji.length;
      input.focus();
    });
  });

  $('#btnEmoji').addEventListener('click', (e) => {
    e.stopPropagation();
    picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
  });

  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target) && e.target !== $('#btnEmoji')) {
      picker.style.display = 'none';
    }
  });
}

// ===== Image Preview =====
window.previewImage = function(url) {
  const overlay = document.createElement('div');
  overlay.className = 'img-overlay';
  overlay.innerHTML = `<img src="${url}">`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
};

// ===== Realtime =====
function subscribeMessages() {
  if (msgChannel) sb.removeChannel(msgChannel);
  msgChannel = sb.channel('msg-rt')
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'chat_messages',
      filter: `receiver_id=eq.${currentUser.id}`
    }, (payload) => {
      const msg = payload.new;
      if (msg.sender_id === activePeerId) {
        messages.push(msg);
        renderMessages();
        markRead(msg.sender_id);
      } else {
        unreadCounts[msg.sender_id] = (unreadCounts[msg.sender_id] || 0) + 1;
      }
      const peer = allUsers.find(u => u.id === msg.sender_id);
      if (peer) {
        peer.lastMsg = msg.msg_type === 'image' ? '[图片]' : msg.content;
        peer.lastTime = msg.created_at;
      }
      sortUsers(); renderUsers(); updateFaviconBadge(); notifyNewMessage();
    }).subscribe();
}

function subscribeUsers() {
  if (userChannel) sb.removeChannel(userChannel);
  userChannel = sb.channel('user-rt')
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'chat_users'
    }, (payload) => {
      const u = payload.new;
      if (!u || u.id === currentUser.id) return;
      if (payload.eventType === 'INSERT') {
        if (!allUsers.find(x => x.id === u.id)) {
          allUsers.push({ ...u, lastMsg: '', lastTime: '' });
          toast(`${u.nickname} 上线了`, 'info');
        }
      } else if (payload.eventType === 'UPDATE') {
        const ex = allUsers.find(x => x.id === u.id);
        if (ex) {
          const was = ex.is_online;
          Object.assign(ex, { is_online: u.is_online, last_seen: u.last_seen, nickname: u.nickname });
          if (!was && u.is_online) toast(`${u.nickname} 上线了`, 'info');
        } else if (u.is_online) {
          // User not in list yet (e.g. logged in after us) — add them
          allUsers.push({ ...u, lastMsg: '', lastTime: '' });
          toast(`${u.nickname} 上线了`, 'info');
        }
      }
      sortUsers(); renderUsers();
      if (u.id === activePeerId) {
        const st = $('#peerStatus');
        st.textContent = u.is_online ? '在线' : `最近 ${fmtTime(u.last_seen)}`;
        st.className = 'peer-status' + (u.is_online ? ' online' : '');
      }
    }).subscribe();
}

// ===== Chat UI Setup =====
function setupChatUI() {
  const input = $('#msgInput');

  $('#btnSend').addEventListener('click', sendMessage);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  input.addEventListener('input', autoResize);
  $('#searchInput').addEventListener('input', renderUsers);
  $('#btnCancelReply').addEventListener('click', cancelReply);

  // Mobile: back button to show sidebar
  $('#btnBack').addEventListener('click', () => {
    document.querySelector('.sidebar').classList.remove('hidden');
  });

  // Paste image (Cmd+V)
  input.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) sendImage(file);
        return;
      }
    }
  });

  // File picker
  $('#btnFile').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.type.startsWith('image/')) sendImage(file);
      else sendFile(file);
    }
    e.target.value = '';
  });

  // Logout
  $('#btnLogout').addEventListener('click', async () => {
    if (currentUser) {
      await sb.from('chat_users').update({
        is_online: false, last_seen: new Date().toISOString()
      }).eq('id', currentUser.id);
    }
    localStorage.removeItem(STORAGE_KEY);
    currentUser = null; activePeerId = null;
    if (msgChannel) sb.removeChannel(msgChannel);
    if (userChannel) sb.removeChannel(userChannel);
    $('#enterScreen').style.display = 'flex';
    $('#chatScreen').style.display = 'none';
  });

  window.addEventListener('beforeunload', () => {
    if (currentUser) {
      const url = `${SUPABASE_URL}/rest/v1/chat_users?id=eq.${currentUser.id}`;
      const body = JSON.stringify({ is_online: false, last_seen: new Date().toISOString() });
      const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
      navigator.sendBeacon && fetch(url, { method: 'PATCH', headers, body, keepalive: true });
    }
  });
}

// ===== Helpers =====
function autoResize() {
  const el = $('#msgInput');
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function sortUsers() {
  allUsers.sort((a, b) => {
    if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
    return (b.lastTime || '').localeCompare(a.lastTime || '');
  });
}

function esc(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date(), diff = now - d;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff/60000) + '分钟前';
  const t = d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
  if (d.toDateString() === now.toDateString()) return t;
  const y = new Date(now); y.setDate(y.getDate()-1);
  if (d.toDateString() === y.toDateString()) return '昨天 '+t;
  return d.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'})+' '+t;
}

function strColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h)%360}, 55%, 50%)`;
}

function toast(msg, type='info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ===== Favicon Badge =====
let _hasNewWhileHidden = false;

function updateFaviconBadge() {
  const total = Object.values(unreadCounts).reduce((s, n) => s + n, 0);
  const showDot = _hasNewWhileHidden && document.hidden;
  _drawFavicon(total, showDot);
  document.title = total > 0 ? `(${total}) IM-liaotian` : 'IM-liaotian';
}

function _drawFavicon(total, forceRedDot) {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // Base icon: chat bubble
  ctx.fillStyle = '#6366f1';
  ctx.beginPath();
  ctx.roundRect(4, 4, 56, 44, 12);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(16, 48); ctx.lineTo(24, 56); ctx.lineTo(32, 48);
  ctx.fill();

  // Three dots
  ctx.fillStyle = '#fff';
  [20, 32, 44].forEach(x => {
    ctx.beginPath(); ctx.arc(x, 26, 4, 0, Math.PI * 2); ctx.fill();
  });

  // Badge number or red dot
  if (total > 0 || forceRedDot) {
    if (total > 0) {
      const text = total > 99 ? '99+' : String(total);
      ctx.font = 'bold 16px sans-serif';
      const badgeW = Math.max(24, ctx.measureText(text).width + 12);
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.roundRect(64 - badgeW - 2, 0, badgeW, 24, 12);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 64 - badgeW / 2 - 2, 12);
    } else {
      // Just a red dot
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(54, 10, 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  let link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.href = canvas.toDataURL('image/png');
}

// Track new messages while tab is hidden → show red dot
function notifyNewMessage() {
  if (document.hidden) {
    _hasNewWhileHidden = true;
    updateFaviconBadge();
    // Flash title
    if (!window._titleFlash) {
      const orig = document.title;
      window._titleFlash = setInterval(() => {
        document.title = document.title === '💬 新消息！' ? orig : '💬 新消息！';
      }, 800);
    }
  }
}

// When user switches back to this tab → clear red dot and stop flashing
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    _hasNewWhileHidden = false;
    if (window._titleFlash) { clearInterval(window._titleFlash); window._titleFlash = null; }
    updateFaviconBadge();
  }
});
