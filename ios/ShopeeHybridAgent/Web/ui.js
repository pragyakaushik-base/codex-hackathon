let products = [];
let cartLines = [];
let lastBundleIds = [];
let realtime = null;
const handledRealtimeCalls = new Set();
const injectedApiBase = window.__AGENT_BASE_URL || '';
const API_BASE = injectedApiBase || (location.protocol === 'file:' ? 'http://127.0.0.1:3000' : '');

const screens = [...document.querySelectorAll('[data-screen]')];
const productList = document.querySelector('.product-list');
const cartList = document.querySelector('.cart-list');
const voiceAgentScreen = document.querySelector('.voice-agent-screen');
const voiceStatus = document.querySelector('[data-voice-status]');

function postNative(event, payload = {}) {
  window.webkit?.messageHandlers?.nativeBridge?.postMessage({ event, ...payload });
}

function go(screenName) {
  screens.forEach((screen) => {
    screen.classList.toggle('is-active', screen.dataset.screen === screenName);
  });

  if (screenName === 'listening') {
    voiceAgentScreen?.classList.add('is-listening');
  } else {
    voiceAgentScreen?.classList.remove('is-speaking');
  }

  postNative('screen_changed', { screen: screenName });
}

function productArt(product, index) {
  const { color, accent } = artColorFor(product, index);
  if (index === 0) {
    return `<div class="part coupling" style="--color:${color};--accent:${accent}"></div>`;
  }
  if (index === 1) {
    return `<div class="part tape" style="--color:${color};--accent:${accent}"></div>`;
  }
  return `<div class="part sealant" style="--color:${color};--accent:${accent}"></div>`;
}

function artColorFor(product, index) {
  const palette = [
    { color: '#e8e9e8', accent: '#cfd2d1' },
    { color: '#eddaf4', accent: '#a773b5' },
    { color: '#1d2327', accent: '#f36f28' },
    { color: '#e6f5fb', accent: '#66a9c8' }
  ];
  if (product.category === 'beauty') return { color: '#ffe6ec', accent: '#df7894' };
  if (product.category === 'fashion') return { color: '#dfe6ef', accent: '#2c3d55' };
  if (product.category === 'electronics') return { color: '#e7f4ff', accent: '#2d73c7' };
  if (product.category === 'grocery') return { color: '#e8f6df', accent: '#6baa45' };
  if (product.category === 'home_decor') return { color: '#f2e8db', accent: '#a7794f' };
  return palette[index % palette.length];
}

function renderProducts() {
  productList.innerHTML = products.map((product, index) => `
    <article class="product-card">
      ${productArt(product, index)}
      <div>
        <h2>${product.title}</h2>
        <strong>$${Number(product.price).toFixed(2)}</strong>
        <p><span class="star">★</span> ${product.rating} <span>(${product.reviewCount || 0})</span></p>
        <small>${formatDelivery(product.delivery)}</small>
      </div>
      <button class="bookmark" type="button" aria-label="Save ${product.title}"></button>
    </article>
  `).join('');

  cartList.innerHTML = cartLines.map((line, index) => `
    <article class="cart-item">
      ${productArt(line.product, index)}
      <h2>${line.product.title}</h2>
      <strong>$${Number(line.lineTotal).toFixed(2)}</strong>
      <span>x${line.quantity}</span>
    </article>
  `).join('');
}

document.addEventListener('click', (event) => {
  const voiceButton = event.target.closest('[data-start-voice]');
  if (voiceButton) {
    startVoiceSession();
    return;
  }

  const addBundleButton = event.target.closest('[data-add-last-bundle]');
  if (addBundleButton) {
    addLastBundleToCart();
    return;
  }

  const target = event.target.closest('[data-go], [data-open-agent]');
  if (!target) return;
  const next = target.dataset.go || 'listening';
  go(next);
});

async function bootstrap() {
  try {
    const data = await getJson('/api/bootstrap?userId=u_001');
    products = data.featuredProducts.slice(0, 3);
    cartLines = data.cart.cart;
    renderProducts();
    postNative('web_ready');
  } catch (error) {
    console.error(error);
    setVoiceStatus('Start the local server to enable voice.');
    products = fallbackProducts();
    cartLines = products.map((product) => ({ product, quantity: 1, lineTotal: product.price }));
    renderProducts();
  }
}

async function startVoiceSession() {
  if (realtime?.peerConnection) {
    setVoiceStatus('Voice is already connected.');
    return;
  }

  try {
    setVoiceStatus('Connecting...');
    go('listening');

    const peerConnection = new RTCPeerConnection();
    const audio = document.createElement('audio');
    audio.autoplay = true;
    peerConnection.ontrack = (event) => {
      audio.srcObject = event.streams[0];
    };

    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    peerConnection.addTrack(mediaStream.getAudioTracks()[0], mediaStream);

    const dataChannel = peerConnection.createDataChannel('oai-events');
    dataChannel.addEventListener('open', () => {
      setVoiceStatus('Connected. Tell me what you need.');
      sendTextPrompt('Greet the user briefly and ask what they need help shopping for.');
    });
    dataChannel.addEventListener('message', handleRealtimeMessage);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await verifyServerReachable();

    const sdpResponse = await fetch(apiUrl('/session'), {
      method: 'POST',
      body: offer.sdp,
      headers: { 'Content-Type': 'application/sdp' }
    });

    if (!sdpResponse.ok) {
      throw new Error(await sdpResponse.text());
    }

    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: await sdpResponse.text()
    });

    realtime = { peerConnection, dataChannel, mediaStream };
  } catch (error) {
    console.error(error);
    setVoiceStatus(`Voice setup failed: ${voiceErrorMessage(error)}`);
  }
}

function sendTextPrompt(text) {
  if (!realtime?.dataChannel || realtime.dataChannel.readyState !== 'open') return;
  realtime.dataChannel.send(JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text }]
    }
  }));
  realtime.dataChannel.send(JSON.stringify({ type: 'response.create' }));
}

async function handleRealtimeMessage(event) {
  const payload = JSON.parse(event.data);
  console.debug('Realtime event', payload);

  if (payload.type === 'response.output_item.done' && payload.item?.type === 'function_call') {
    await runRealtimeTool(payload.item);
  }

  if (payload.type === 'conversation.item.done' && payload.item?.type === 'function_call') {
    await runRealtimeTool(payload.item);
  }

  if (payload.type === 'response.output_text.delta' && payload.delta) {
    setVoiceStatus(payload.delta);
  }

  if (payload.type === 'response.output_audio_transcript.delta' && payload.delta) {
    setVoiceStatus(payload.delta);
  }

  if (payload.type === 'response.done') {
    setVoiceStatus('Listening for the next step.');
  }
}

async function runRealtimeTool(functionCall) {
  if (handledRealtimeCalls.has(functionCall.call_id)) return;
  handledRealtimeCalls.add(functionCall.call_id);

  const args = parseArguments(functionCall.arguments);
  if (!args.userId) args.userId = 'u_001';
  setVoiceStatus(`Running ${functionCall.name.replaceAll('_', ' ')}...`);

  const response = await postJson('/api/realtime-tool', {
    name: functionCall.name,
    arguments: args
  });

  applyToolResult(functionCall.name, response.result);

  realtime.dataChannel.send(JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: functionCall.call_id,
      output: JSON.stringify(response.result)
    }
  }));
  realtime.dataChannel.send(JSON.stringify({ type: 'response.create' }));
}

function applyToolResult(name, result) {
  if (name === 'search_catalog') {
    products = (result.results || []).map((entry) => entry.product);
    if (products.length) go('suggestions');
  }

  if (name === 'recommend_bundle') {
    const bundle = result.bundle || [];
    lastBundleIds = [result.primaryProduct?.id, ...bundle.map((product) => product.id)].filter(Boolean);
    products = [result.primaryProduct, ...bundle].filter(Boolean);
    go('suggestions');
  }

  if (name === 'compare_products' && result.products?.length) {
    products = result.products;
    go('suggestions');
  }

  if (name === 'add_to_cart') {
    cartLines = result.cart || [];
    go('cart');
  }

  if (name === 'checkout_preview') {
    cartLines = result.cart || [];
    go('checkout');
  }

  renderProducts();
}

async function addLastBundleToCart() {
  const ids = lastBundleIds.length ? lastBundleIds : products.map((product) => product.id);
  if (!ids.length) return;
  const result = await postJson('/api/tools/add-to-cart', {
    userId: 'u_001',
    productIds: ids,
    quantity: 1
  });
  cartLines = result.cart || [];
  renderProducts();
  await postJson('/api/tools/apply-best-voucher', { userId: 'u_001' });
  go('cart');
}

function parseArguments(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function getJson(url) {
  const response = await fetch(apiUrl(url));
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function postJson(url, payload) {
  const response = await fetch(apiUrl(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function verifyServerReachable() {
  try {
    await getJson('/api/bootstrap?userId=u_001');
  } catch (error) {
    throw new Error(`LOCAL_SERVER_UNREACHABLE:${voiceErrorMessage(error)}`);
  }
}

function apiUrl(url) {
  if (/^https?:\/\//.test(url)) return url;
  return `${API_BASE}${url}`;
}

function setVoiceStatus(text) {
  if (voiceStatus) voiceStatus.textContent = text;
}

function voiceErrorMessage(error) {
  const message = String(error?.message || error || 'Unknown error');
  if (message.startsWith('LOCAL_SERVER_UNREACHABLE:')) return message.replace('LOCAL_SERVER_UNREACHABLE:', '');
  if (message.includes('OPENAI_API_KEY')) return 'missing OpenAI API key on the local server.';
  if (message.includes('Failed to fetch') || message.includes('Load failed')) {
    return `cannot reach ${API_BASE || 'the local server'}.`;
  }
  if (message.includes('Permission') || message.includes('NotAllowedError')) return 'microphone permission was denied.';
  if (message.includes('NotFoundError')) return 'no microphone was found.';
  if (message.length > 96) return `${message.slice(0, 93)}...`;
  return message;
}

function formatDelivery(delivery) {
  return String(delivery || 'standard').replace('_', '-').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fallbackProducts() {
  return [
    { id: 'HW001', title: '15mm PVC Slip Coupling', category: 'home_repair', price: 4.2, rating: 4.8, reviewCount: 512, delivery: 'next_day' },
    { id: 'HW002', title: 'PTFE Teflon Seal Tape', category: 'home_repair', price: 1.2, rating: 4.7, reviewCount: 342, delivery: 'next_day' },
    { id: 'HW003', title: 'Waterproof Pipe Sealant', category: 'home_repair', price: 6.8, rating: 4.6, reviewCount: 198, delivery: 'same_day' }
  ];
}

bootstrap();
