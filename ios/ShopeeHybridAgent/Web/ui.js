let products = [];
let cartLines = [];
let lastBundleIds = [];
let cartCheckout = null;
let realtime = null;
let voiceSessionStarting = false;
let voiceStartToken = 0;
let cameraStream = null;

const handledRealtimeCalls = new Set();
const injectedApiBase = window.__AGENT_BASE_URL || '';
const API_BASE = injectedApiBase || (location.protocol === 'file:' ? 'http://127.0.0.1:3000' : '');
const screens = [...document.querySelectorAll('[data-screen]')];
const productList = document.querySelector('.product-list');
const cartList = document.querySelector('.cart-list');
const cartMessage = document.querySelector('[data-cart-message], [data-cart-summary]');
const cartTitle = document.querySelector('[data-cart-title], [data-cart-count]');
const clearCartButton = document.querySelector('[data-clear-cart]');
const openCheckoutButton = document.querySelector('[data-open-checkout]');
const voucherCard = document.querySelector('[data-voucher-card]');
const voucherLabel = document.querySelector('[data-voucher-label]');
const voucherCode = document.querySelector('[data-voucher-code]');
const voucherSaving = document.querySelector('[data-voucher-saving], [data-cart-total]');
const checkoutMessage = document.querySelector('[data-checkout-message]');
const checkoutSubtotalLabel = document.querySelector('[data-checkout-subtotal-label]');
const checkoutSubtotal = document.querySelector('[data-checkout-subtotal]');
const checkoutShipping = document.querySelector('[data-checkout-shipping]');
const checkoutDiscount = document.querySelector('[data-checkout-discount]');
const checkoutTotal = document.querySelector('[data-checkout-total]');
const checkoutDelivery = document.querySelector('[data-checkout-delivery]');
const checkoutPayment = document.querySelector('[data-checkout-payment]');
const proceedCheckoutButton = document.querySelector('[data-proceed-checkout]');
const voiceAgentScreen = document.querySelector('.voice-agent-screen');
const voiceStatus = document.querySelector('[data-voice-status]');
const activityList = document.querySelector('[data-agent-activity]');
const activitySummary = document.querySelector('[data-agent-activity-summary]');
const cameraFeed = document.querySelector('[data-camera-feed]');
const cameraStatus = document.querySelector('[data-camera-status]');
const cameraPreview = document.querySelector('.camera-preview');
const agentInput = document.querySelector('[data-agent-input]');
const agentSummary = document.querySelector('[data-agent-summary]');
const statusChip = document.querySelector('[data-status-chip]');

const activitySteps = [
  { tool: 'check_user_history', label: 'Checking your shopping history' },
  { tool: 'analyze_surroundings', label: 'Analyzing camera view' },
  { tool: 'classify_need', label: 'Understanding your request' },
  { tool: 'search_catalog', label: 'Searching Shopee catalog' },
  { tool: 'build_spatial_setup', label: 'Designing your AR setup' },
  { tool: 'recommend_bundle', label: 'Finding useful add-ons' },
  { tool: 'compare_products', label: 'Comparing best matches' },
  { tool: 'add_to_cart', label: 'Adding to cart' },
  { tool: 'remove_from_cart', label: 'Removing from cart' },
  { tool: 'apply_best_voucher', label: 'Checking best voucher' },
  { tool: 'checkout_preview', label: 'Preparing checkout preview' }
];
const activityState = new Map(activitySteps.map((step) => [step.tool, 'idle']));

let nativeState = {
  prompt: agentInput?.value || '',
  sceneStatus: '',
  planeDetected: false,
  selectedProductID: null,
  recommendations: [],
  cart: []
};

function postNative(event, payload = {}) {
  window.webkit?.messageHandlers?.nativeBridge?.postMessage({ event, ...payload });
}

function setCameraState(state, message = '') {
  if (cameraPreview) {
    cameraPreview.dataset.cameraState = state;
  }

  if (cameraStatus) {
    cameraStatus.textContent = message;
    cameraStatus.hidden = !message;
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }

  if (cameraFeed) {
    cameraFeed.pause();
    cameraFeed.srcObject = null;
  }
}

async function startCamera() {
  if (!cameraFeed) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraState('error', 'Camera is not supported on this device.');
    return;
  }
  if (cameraStream) {
    setCameraState('live');
    return;
  }

  setCameraState('loading', 'Opening camera...');

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' }
      },
      audio: false
    });

    cameraStream = stream;
    cameraFeed.srcObject = stream;
    await cameraFeed.play();
    setCameraState('live');
  } catch (error) {
    console.error('Unable to start camera preview', error);
    setCameraState('error', 'Camera access was denied or is unavailable.');
  }
}

function go(screenName, options = {}) {
  const { autoStartVoice = true } = options;

  screens.forEach((screen) => {
    screen.classList.toggle('is-active', screen.dataset.screen === screenName);
  });

  if (screenName === 'listening') {
    if (realtime?.peerConnection || voiceSessionStarting) {
      voiceAgentScreen?.classList.add('is-listening');
    }
  } else {
    voiceAgentScreen?.classList.remove('is-speaking');
  }

  if (screenName === 'camera') {
    startCamera();
  } else {
    stopCamera();
  }

  postNative('screen_changed', { screen: screenName });

  if (screenName === 'listening' && autoStartVoice) {
    startVoiceSession({ navigate: false });
  }
}

function productArt(product, index = 0) {
  const accent = product?.accentHex;
  if (accent) {
    return `
      <div class="gear-thumb" style="--accent:${accent}">
        <span class="gear-body"></span>
        <span class="gear-base"></span>
      </div>
    `;
  }

  const palette = [
    { color: '#e8e9e8', accent: '#cfd2d1' },
    { color: '#eddaf4', accent: '#a773b5' },
    { color: '#1d2327', accent: '#f36f28' },
    { color: '#e6f5fb', accent: '#66a9c8' }
  ];
  const selected = palette[index % palette.length];
  if (index === 0) {
    return `<div class="part coupling" style="--color:${selected.color};--accent:${selected.accent}"></div>`;
  }
  if (index === 1) {
    return `<div class="part tape" style="--color:${selected.color};--accent:${selected.accent}"></div>`;
  }
  return `<div class="part sealant" style="--color:${selected.color};--accent:${selected.accent}"></div>`;
}

function productMedia(product, index, size = 'large') {
  if (product?.imageUrl) {
    return `
      <figure class="product-media product-media-${size}">
        <img src="${escapeHtml(product.imageUrl)}" alt="${escapeHtml(product.title || 'Product image')}" loading="lazy" />
      </figure>
    `;
  }

  return `<figure class="product-media product-media-${size}">${productArt(product, index)}</figure>`;
}

function formatPrice(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? number.toFixed(0) : number.toFixed(2);
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function currentProducts() {
  return nativeState.recommendations.length ? nativeState.recommendations : products;
}

function currentCartLines() {
  if (nativeState.cart.length) {
    return nativeState.cart.map((product) => ({
      product,
      quantity: 1,
      lineTotal: product.price
    }));
  }

  return cartLines;
}

function renderProducts() {
  const visibleProducts = currentProducts();
  const visibleCartLines = currentCartLines();
  const selectedProductID = nativeState.selectedProductID;

  if (agentInput) {
    agentInput.value = nativeState.prompt || agentInput.value;
  }

  if (agentSummary) {
    agentSummary.textContent = nativeState.sceneStatus || 'I found the best matches for your leak. Here are the top options.';
  }

  if (statusChip) {
    statusChip.textContent = nativeState.planeDetected ? 'Desk detected' : 'Desk not detected';
  }

  productList.innerHTML = visibleProducts.map((product, index) => `
    <article class="product-card ${product.id === selectedProductID ? 'is-selected' : ''}">
      ${productMedia(product, index)}
      <div>
        <h2>${escapeHtml(product.title)}</h2>
        <strong>$${formatPrice(product.price)}</strong>
        <p><span class="star">★</span> ${Number(product.rating || 0).toFixed(1)} <span>${product.reviewCount ? `(${product.reviewCount})` : `#${index + 1}`}</span></p>
        <small>${formatDelivery(product.delivery)}</small>
        ${product.summary ? `<small>${escapeHtml(product.summary)}</small>` : ''}
      </div>
      <button class="bookmark" type="button" data-select-product="${escapeHtml(product.id)}" aria-label="Select ${escapeHtml(product.title)}">${product.id === selectedProductID ? 'Selected' : nativeState.recommendations.length ? 'Pick' : 'Save'}</button>
    </article>
  `).join('');

  cartList.innerHTML = visibleCartLines.map((line, index) => `
    <article class="cart-item">
      ${productMedia(line.product, index, 'small')}
      <div class="cart-item-main">
        <h2>${escapeHtml(line.product.title)}</h2>
        <strong>$${formatPrice(line.lineTotal)}</strong>
      </div>
      <span>x${line.quantity || 1}</span>
      <button class="cart-remove" type="button" data-remove-cart-item="${escapeHtml(line.product.id)}" aria-label="Remove ${escapeHtml(line.product.title)}">Remove</button>
    </article>
  `).join('');

  renderCartSummary();
  renderCheckoutSummary();
}

function renderCartSummary() {
  const visibleCartLines = currentCartLines();
  const itemCount = visibleCartLines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);

  if (cartTitle) {
    cartTitle.textContent = `Cart (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`;
  }

  if (cartMessage) {
    if (!itemCount) {
      cartMessage.textContent = nativeState.recommendations.length
        ? 'Select a recommendation, then add it to the cart.'
        : 'Your cart is empty. Add recommended products to preview savings and checkout.';
    } else if (cartCheckout?.voucher) {
      cartMessage.textContent = `I found ${itemCount} ${itemCount === 1 ? 'item' : 'items'} in your cart and applied the best voucher.`;
    } else {
      cartMessage.textContent = `${visibleCartLines[visibleCartLines.length - 1].product.title} is in your cart.`;
    }
  }

  if (clearCartButton) clearCartButton.disabled = itemCount === 0;
  if (openCheckoutButton) openCheckoutButton.disabled = itemCount === 0;

  const voucher = cartCheckout?.voucher;
  const discount = Number(cartCheckout?.voucherDiscount || 0);
  if (voucherCard) voucherCard.classList.toggle('is-empty', !voucher);
  if (voucherLabel) voucherLabel.textContent = voucher ? 'Voucher Applied' : 'Voucher';
  if (voucherCode) voucherCode.textContent = voucher?.code || 'No eligible voucher';
  if (voucherSaving) {
    voucherSaving.textContent = voucher
      ? `Saved $${discount.toFixed(2)}`
      : itemCount
        ? `Subtotal ${formatMoney(visibleCartLines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0))}`
        : 'Your cart is empty';
  }
}

function renderCheckoutSummary() {
  const visibleCartLines = currentCartLines();
  const checkout = cartCheckout || {
    cart: visibleCartLines,
    subtotal: visibleCartLines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0),
    shippingFee: visibleCartLines.length ? 2.99 : 0,
    voucherDiscount: 0,
    total: visibleCartLines.reduce((sum, line) => sum + Number(line.lineTotal || 0), 0) + (visibleCartLines.length ? 2.99 : 0),
    estimatedDelivery: null,
    paymentMethod: 'ShopeePay'
  };
  const itemCount = (checkout.cart || visibleCartLines).reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const hasItems = itemCount > 0;
  const discount = Number(checkout.voucherDiscount || 0);

  if (checkoutMessage) {
    checkoutMessage.textContent = hasItems
      ? "Here's your order summary. Shall we proceed to checkout?"
      : 'Your cart is empty. Add items before checkout.';
  }
  if (checkoutSubtotalLabel) checkoutSubtotalLabel.textContent = `Subtotal (${itemCount} ${itemCount === 1 ? 'item' : 'items'})`;
  if (checkoutSubtotal) checkoutSubtotal.textContent = formatMoney(checkout.subtotal || 0);
  if (checkoutShipping) checkoutShipping.textContent = formatMoney(checkout.shippingFee || 0);
  if (checkoutDiscount) checkoutDiscount.textContent = discount ? `-${formatMoney(discount)}` : formatMoney(0);
  if (checkoutTotal) checkoutTotal.textContent = formatMoney(checkout.total || 0);
  if (checkoutDelivery) checkoutDelivery.textContent = checkout.estimatedDelivery || '-';
  if (checkoutPayment) checkoutPayment.textContent = checkout.paymentMethod || 'ShopeePay';
  if (proceedCheckoutButton) proceedCheckoutButton.disabled = !hasItems;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function renderActivity() {
  if (!activityList) return;

  const hasProgress = activitySteps.some((step) => activityState.get(step.tool) !== 'idle');
  let visibleSteps = activitySteps.filter((step) => {
    if (!hasProgress) return ['check_user_history', 'classify_need', 'search_catalog', 'build_spatial_setup', 'recommend_bundle'].includes(step.tool);
    return activityState.get(step.tool) !== 'idle';
  });

  if (hasProgress) {
    const lastVisibleIndex = Math.max(...visibleSteps.map((step) => activitySteps.findIndex((candidate) => candidate.tool === step.tool)));
    const nextStep = activitySteps.slice(lastVisibleIndex + 1).find((step) => {
      if (step.tool === 'remove_from_cart') return false;
      return activityState.get(step.tool) === 'idle';
    });
    if (nextStep) visibleSteps.push(nextStep);
  }

  visibleSteps = visibleSteps.slice(-5);

  activityList.innerHTML = visibleSteps.map((step) => {
    const status = activityState.get(step.tool) || 'idle';
    return `<li class="${status}" data-tool-step="${step.tool}">${escapeHtml(step.label)}</li>`;
  }).join('');

  if (!activitySummary) return;
  const activeStep = activitySteps.find((step) => activityState.get(step.tool) === 'active');
  if (activeStep) {
    activitySummary.textContent = activeStep.label;
    return;
  }

  const doneCount = activitySteps.filter((step) => activityState.get(step.tool) === 'done').length;
  activitySummary.textContent = doneCount ? `${doneCount} steps completed` : 'Waiting for your request';
}

function resetActivity() {
  activitySteps.forEach((step) => activityState.set(step.tool, 'idle'));
  renderActivity();
}

function setToolActivity(toolName, status) {
  if (!activityState.has(toolName)) return;
  activityState.set(toolName, status);
  renderActivity();
}

function submitAgentPrompt(prompt) {
  const value = prompt?.trim();
  if (!value) return;
  nativeState.prompt = value;
  postNative('agent_prompt', { prompt: value });
}

window.syncNativeState = function syncNativeState(nextState) {
  nativeState = {
    ...nativeState,
    ...nextState,
    recommendations: nextState.recommendations || [],
    cart: nextState.cart || []
  };

  if (nextState.checkout) {
    cartCheckout = nextState.checkout;
  }

  renderProducts();

  if (nativeState.recommendations.length && !document.querySelector('[data-screen="suggestions"]').classList.contains('is-active')) {
    go('suggestions');
  }

  if (nativeState.cart.length && !document.querySelector('[data-screen="cart"]').classList.contains('is-active')) {
    go('cart');
  }
};

document.addEventListener('click', (event) => {
  const voiceButton = event.target.closest('[data-start-voice]');
  if (voiceButton) {
    toggleVoiceSession();
    return;
  }

  const nativeCameraButton = event.target.closest('[data-go="camera"]');
  if (nativeCameraButton) {
    postNative('cameraTapped');
    return;
  }

  const addBundleButton = event.target.closest('[data-add-last-bundle]');
  if (addBundleButton) {
    addLastBundleToCart();
    return;
  }

  const removeCartButton = event.target.closest('[data-remove-cart-item]');
  if (removeCartButton) {
    removeCartItem(removeCartButton.dataset.removeCartItem);
    return;
  }

  const clearCartTarget = event.target.closest('[data-clear-cart]');
  if (clearCartTarget) {
    clearCart();
    return;
  }

  const openCheckoutTarget = event.target.closest('[data-open-checkout]');
  if (openCheckoutTarget) {
    openCheckout();
    return;
  }

  const submitButton = event.target.closest('[data-agent-submit]');
  if (submitButton) {
    submitAgentPrompt(agentInput?.value || '');
    return;
  }

  const commandButton = event.target.closest('[data-agent-command]');
  if (commandButton) {
    submitAgentPrompt(commandButton.dataset.agentCommand || '');
    return;
  }

  const selectButton = event.target.closest('[data-select-product]');
  if (selectButton) {
    nativeState.selectedProductID = selectButton.dataset.selectProduct;
    postNative('select_product', { productId: selectButton.dataset.selectProduct });
    renderProducts();
    return;
  }

  const nativeAction = event.target.closest('[data-native-action]');
  if (nativeAction?.dataset.nativeAction === 'place') {
    postNative('place_recommendations');
    return;
  }

  if (nativeAction?.dataset.nativeAction === 'cart') {
    postNative('add_selected_to_cart');
  }

  const target = event.target.closest('[data-go], [data-open-agent]');
  if (!target) return;
  const next = target.dataset.go || 'listening';
  go(next);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && event.target === agentInput) {
    event.preventDefault();
    submitAgentPrompt(agentInput.value);
  }
});

async function bootstrap() {
  try {
    const data = await getJson('/api/bootstrap?userId=u_001');
    products = data.featuredProducts.slice(0, 3);
    cartLines = data.cart.cart;
    cartCheckout = data.cart.checkout;
  } catch (error) {
    console.error(error);
    setVoiceStatus('Start the local server to enable voice.');
    products = fallbackProducts();
    cartLines = products.map((product) => ({ product, quantity: 1, lineTotal: product.price }));
    cartCheckout = null;
  } finally {
    renderProducts();
    postNative('web_ready');
  }
}

function toggleVoiceSession() {
  if (realtime?.peerConnection || voiceSessionStarting) {
    stopVoiceSession();
    return;
  }

  startVoiceSession();
}

async function startVoiceSession({ navigate = true } = {}) {
  if (voiceSessionStarting) {
    setVoiceStatus('Voice is connecting...');
    return;
  }

  if (realtime?.peerConnection) {
    setVoiceStatus('Voice is already connected.');
    return;
  }

  voiceSessionStarting = true;
  const startToken = ++voiceStartToken;
  handledRealtimeCalls.clear();
  resetActivity();
  voiceAgentScreen?.classList.add('is-listening');
  let peerConnection = null;
  let dataChannel = null;
  let mediaStream = null;

  try {
    setVoiceStatus('Connecting...');
    if (navigate) go('listening', { autoStartVoice: false });

    peerConnection = new RTCPeerConnection();
    const audio = document.createElement('audio');
    audio.autoplay = true;
    peerConnection.ontrack = (event) => {
      audio.srcObject = event.streams[0];
    };

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    if (startToken !== voiceStartToken) {
      closeVoiceResources({ peerConnection, dataChannel, mediaStream });
      return;
    }

    const microphoneTrack = mediaStream.getAudioTracks()[0];
    monitorMicrophoneTrack(microphoneTrack);
    peerConnection.addTrack(microphoneTrack, mediaStream);

    dataChannel = peerConnection.createDataChannel('oai-events');
    dataChannel.addEventListener('open', () => {
      setVoiceStatus('Connected. Tell me what you need.');
      sendTextPrompt('Greet the user briefly and ask what they need help shopping for.', dataChannel);
    });
    dataChannel.addEventListener('message', handleRealtimeMessage);

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    await verifyServerReachable();
    if (startToken !== voiceStartToken) {
      closeVoiceResources({ peerConnection, dataChannel, mediaStream });
      return;
    }

    const sdpResponse = await fetch(apiUrl('/session'), {
      method: 'POST',
      body: offer.sdp,
      headers: { 'Content-Type': 'application/sdp' }
    });

    if (!sdpResponse.ok) {
      throw new Error(await sdpResponse.text());
    }

    if (startToken !== voiceStartToken) {
      closeVoiceResources({ peerConnection, dataChannel, mediaStream });
      return;
    }

    await peerConnection.setRemoteDescription({
      type: 'answer',
      sdp: await sdpResponse.text()
    });

    if (startToken !== voiceStartToken) {
      closeVoiceResources({ peerConnection, dataChannel, mediaStream });
      return;
    }

    realtime = { peerConnection, dataChannel, mediaStream };
  } catch (error) {
    console.error(error);
    closeVoiceResources({ peerConnection, dataChannel, mediaStream });
    voiceAgentScreen?.classList.remove('is-listening');
    setVoiceStatus(`Voice setup failed: ${voiceErrorMessage(error)}`);
  } finally {
    if (startToken === voiceStartToken) {
      voiceSessionStarting = false;
    }
  }
}

function stopVoiceSession() {
  if (!realtime && !voiceSessionStarting) return;
  voiceStartToken += 1;

  try {
    closeVoiceResources(realtime);
  } finally {
    realtime = null;
    voiceSessionStarting = false;
    voiceAgentScreen?.classList.remove('is-listening', 'is-speaking');
    setVoiceStatus('Tap the mic to start listening');
  }
}

function closeVoiceResources(session) {
  session?.dataChannel?.close();
  session?.peerConnection?.getSenders().forEach((sender) => {
    sender.track?.stop();
  });
  session?.mediaStream?.getTracks().forEach((track) => track.stop());
  session?.peerConnection?.close();
}

function sendTextPrompt(text, channel = realtime?.dataChannel) {
  if (!channel || channel.readyState !== 'open') return;
  channel.send(JSON.stringify({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text }]
    }
  }));
  channel.send(JSON.stringify({ type: 'response.create' }));
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
  setToolActivity(functionCall.name, 'active');
  setVoiceStatus(`Running ${functionCall.name.replaceAll('_', ' ')}...`);

  if (functionCall.name === 'analyze_surroundings') {
    await enrichSurroundingsArgs(args);
  }

  const response = await postJson('/api/realtime-tool', {
    name: functionCall.name,
    arguments: args
  });

  setToolActivity(functionCall.name, 'done');
  await applyToolResult(functionCall.name, response.result);

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

async function applyToolResult(name, result) {
  if (name === 'analyze_surroundings') {
    const summary = result.summary || 'Visual context captured.';
    setVoiceStatus(summary);
    if (result.possibleCategory === 'home_repair') go('thinking');
  }

  if (name === 'search_catalog') {
    products = (result.results || []).map((entry) => entry.product);
    if (products.length) go('suggestions');
  }

  if (name === 'build_spatial_setup') {
    const setupProducts = (result.items || []).map((item) => item.product).filter(Boolean);
    if (setupProducts.length) {
      products = setupProducts;
      lastBundleIds = setupProducts.map((product) => product.id);
      nativeState.selectedProductID = setupProducts[0].id;
      setVoiceStatus(result.summary || 'Your 3D setup is ready.');
      postNative('apply_spatial_setup', { setup: result });
      go('suggestions');
    }
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

  if (name === 'add_to_cart' || name === 'remove_from_cart') {
    cartLines = result.cart || [];
    await refreshCartPreview();
    go('cart');
  }

  if (name === 'checkout_preview') {
    cartLines = result.cart || [];
    cartCheckout = result;
    go('checkout');
  }

  renderProducts();
}

async function enrichSurroundingsArgs(args) {
  if (args.imageDataUrl || args.imageBase64 || args.imageUrl) return args;

  setVoiceStatus('Capturing the current view...');
  try {
    const nativeFrame = await captureNativeSurroundings(args);
    if (nativeFrame.imageDataUrl) {
      args.imageDataUrl = nativeFrame.imageDataUrl;
    }
    if (nativeFrame.imageBase64) {
      args.imageBase64 = nativeFrame.imageBase64;
    }
    if (nativeFrame.mimeType) {
      args.mimeType = nativeFrame.mimeType;
    }
    setVoiceStatus('View captured. Analyzing...');
    return args;
  } catch (nativeError) {
    console.warn('Native surroundings capture unavailable', nativeError);
  }

  setVoiceStatus('Opening camera for a quick look...');
  try {
    const webFrame = await captureCameraFrame();
    args.imageDataUrl = webFrame.imageDataUrl;
    args.mimeType = webFrame.mimeType;
    setVoiceStatus('Camera view captured. Analyzing...');
  } catch (webError) {
    console.warn('Camera capture unavailable', webError);
    args.captureError = voiceErrorMessage(webError);
    setVoiceStatus('Camera unavailable. I will infer from your request.');
  }

  return args;
}

async function captureNativeSurroundings(args = {}) {
  if (typeof window.captureNativeCameraView !== 'function') {
    throw new Error('native camera bridge is unavailable.');
  }

  const payload = await window.captureNativeCameraView({
    question: args.question || args.userText || ''
  });

  if (!payload || (!payload.imageDataUrl && !payload.imageBase64)) {
    throw new Error('native camera bridge returned no image.');
  }

  return payload;
}

async function captureCameraFrame() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('camera is not available in this web view.');
  }

  let stream = null;
  let video = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 960 },
        height: { ideal: 1280 }
      }
    });

    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    await waitForVideoFrame(video);

    const maxEdge = 720;
    const sourceWidth = video.videoWidth || 720;
    const sourceHeight = video.videoHeight || 720;
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    return {
      imageDataUrl: canvas.toDataURL('image/jpeg', 0.82),
      mimeType: 'image/jpeg'
    };
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
    if (video) video.srcObject = null;
    await restoreRealtimeMicrophoneIfNeeded();
  }
}

function monitorMicrophoneTrack(track) {
  if (!track) return;
  track.addEventListener('ended', () => {
    console.warn('Realtime microphone track ended.');
    setVoiceStatus('Microphone paused. Restoring voice...');
  }, { once: true });
}

async function restoreRealtimeMicrophoneIfNeeded() {
  if (!realtime?.peerConnection || realtime.peerConnection.connectionState === 'closed') return;

  const sender = realtime.peerConnection.getSenders().find((candidate) => candidate.track?.kind === 'audio');
  const currentTrack = sender?.track || realtime.mediaStream?.getAudioTracks()[0];
  if (currentTrack?.readyState === 'live') return;

  try {
    const replacementStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const replacementTrack = replacementStream.getAudioTracks()[0];
    monitorMicrophoneTrack(replacementTrack);

    if (sender) {
      await sender.replaceTrack(replacementTrack);
    } else {
      realtime.peerConnection.addTrack(replacementTrack, replacementStream);
    }

    realtime.mediaStream?.getTracks().forEach((track) => track.stop());
    realtime.mediaStream = replacementStream;
    voiceAgentScreen?.classList.add('is-listening');
    setVoiceStatus('Microphone restored. Listening for the next step.');
  } catch (error) {
    console.error('Failed to restore microphone', error);
    setVoiceStatus(`Microphone paused: ${voiceErrorMessage(error)}`);
  }
}

function waitForVideoFrame(video) {
  if ('requestVideoFrameCallback' in video) {
    return new Promise((resolve) => video.requestVideoFrameCallback(() => resolve()));
  }

  return new Promise((resolve) => {
    if (video.readyState >= 2) {
      resolve();
      return;
    }
    video.addEventListener('loadeddata', () => resolve(), { once: true });
  });
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
  cartCheckout = await postJson('/api/tools/checkout-preview', { userId: 'u_001' });
  renderProducts();
  go('cart');
}

async function refreshCartPreview() {
  try {
    cartCheckout = await postJson('/api/tools/checkout-preview', { userId: 'u_001' });
  } catch (error) {
    console.error(error);
    cartCheckout = null;
  }
  renderCartSummary();
  renderCheckoutSummary();
}

async function openCheckout() {
  await refreshCartPreview();
  cartLines = cartCheckout?.cart || cartLines;
  renderProducts();
  go('checkout');
}

async function removeCartItem(productId) {
  if (!productId) return;
  const result = await postJson('/api/tools/remove-from-cart', {
    userId: 'u_001',
    productId
  });
  cartLines = result.cart || [];
  cartCheckout = await postJson('/api/tools/checkout-preview', { userId: 'u_001' });
  renderProducts();
}

async function clearCart() {
  const result = await postJson('/api/cart/reset', { userId: 'u_001' });
  cartLines = result.cart || [];
  cartCheckout = result.checkout || null;
  nativeState.cart = [];
  renderProducts();
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
  if (message.includes('Failed to create Realtime session')) return 'the local server could not create the Realtime session.';
  if (message.includes('Failed to fetch') || message.includes('Load failed')) {
    return `cannot reach ${API_BASE || 'the local server'}.`;
  }
  if (message.includes('Permission') || message.includes('NotAllowedError')) return 'microphone permission was denied.';
  if (message.includes('NotFoundError')) return 'no microphone was found.';
  if (message.length > 96) return `${message.slice(0, 93)}...`;
  return message;
}

function formatDelivery(delivery) {
  return String(delivery || 'standard').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fallbackProducts() {
  return [
    { id: 'HW001', title: '15mm PVC Slip Coupling', category: 'home_repair', price: 4.2, rating: 4.8, reviewCount: 512, delivery: 'next_day', accentHex: '#ee4d2d' },
    { id: 'HW002', title: 'PTFE Teflon Seal Tape', category: 'home_repair', price: 1.2, rating: 4.7, reviewCount: 342, delivery: 'next_day', accentHex: '#f6a623' },
    { id: 'HW003', title: 'Waterproof Pipe Sealant', category: 'home_repair', price: 6.8, rating: 4.6, reviewCount: 198, delivery: 'same_day', accentHex: '#3cb371' }
  ];
}

renderProducts();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopCamera();
  }
});
window.addEventListener('pagehide', stopCamera);
go('home');
bootstrap();
renderActivity();
