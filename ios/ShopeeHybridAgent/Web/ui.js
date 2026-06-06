const products = [
  {
    title: '15mm PVC Slip Coupling',
    price: '$4.20',
    rating: '4.8',
    reviews: '(512)',
    delivery: 'Next-day delivery',
    color: '#e8e9e8',
    accent: '#cfd2d1'
  },
  {
    title: 'Teflon Seal Tape',
    price: '$1.20',
    rating: '4.7',
    reviews: '(342)',
    delivery: 'Next-day delivery',
    color: '#eddaf4',
    accent: '#a773b5'
  },
  {
    title: 'Waterproof Sealant',
    price: '$6.80',
    rating: '4.6',
    reviews: '(198)',
    delivery: 'Same-day delivery',
    color: '#1d2327',
    accent: '#f36f28'
  }
];

const screens = [...document.querySelectorAll('[data-screen]')];
const productList = document.querySelector('.product-list');
const cartList = document.querySelector('.cart-list');

function postNative(event, payload = {}) {
  window.webkit?.messageHandlers?.nativeBridge?.postMessage({ event, ...payload });
}

function go(screenName) {
  screens.forEach((screen) => {
    screen.classList.toggle('is-active', screen.dataset.screen === screenName);
  });
  postNative('screen_changed', { screen: screenName });
}

function productArt(product, index) {
  if (index === 0) {
    return `<div class="part coupling" style="--color:${product.color};--accent:${product.accent}"></div>`;
  }
  if (index === 1) {
    return `<div class="part tape" style="--color:${product.color};--accent:${product.accent}"></div>`;
  }
  return `<div class="part sealant" style="--color:${product.color};--accent:${product.accent}"></div>`;
}

function renderProducts() {
  productList.innerHTML = products.map((product, index) => `
    <article class="product-card">
      ${productArt(product, index)}
      <div>
        <h2>${product.title}</h2>
        <strong>${product.price}</strong>
        <p><span class="star">★</span> ${product.rating} <span>${product.reviews}</span></p>
        <small>${product.delivery}</small>
      </div>
      <button class="bookmark" type="button" aria-label="Save ${product.title}"></button>
    </article>
  `).join('');

  cartList.innerHTML = products.map((product, index) => `
    <article class="cart-item">
      ${productArt(product, index)}
      <h2>${product.title}</h2>
      <strong>${product.price}</strong>
      <span>x1</span>
    </article>
  `).join('');
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-go], [data-open-agent]');
  if (!target) return;
  const next = target.dataset.go || 'listening';
  go(next);
});

renderProducts();
postNative('web_ready');
