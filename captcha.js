const { createCanvas } = require('@napi-rs/canvas');
const crypto = require('crypto');

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

const COLORS = [
  '#2d3436', '#0984e3', '#00b894', '#e17055',
  '#6c5ce7', '#d63031', '#00cec9', '#fdcb6e',
];

function randomChar() {
  return CHARS[crypto.randomInt(0, CHARS.length)];
}

function randomColor() {
  return COLORS[crypto.randomInt(0, COLORS.length)];
}

function randomRotation() {
  return (Math.random() - 0.5) * 0.8;
}

function randomOffset(max) {
  return crypto.randomInt(0, max);
}

function generateCaptchaText(length = 6) {
  let text = '';
  for (let i = 0; i < length; i++) {
    text += randomChar();
  }
  return text;
}

function drawNoise(ctx, width, height) {
  for (let i = 0; i < 120; i++) {
    ctx.strokeStyle = randomColor();
    ctx.globalAlpha = 0.3 + Math.random() * 0.4;
    ctx.beginPath();
    ctx.moveTo(randomOffset(width), randomOffset(height));
    ctx.lineTo(randomOffset(width), randomOffset(height));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawDots(ctx, width, height) {
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = randomColor();
    ctx.globalAlpha = 0.4 + Math.random() * 0.4;
    ctx.beginPath();
    ctx.arc(randomOffset(width), randomOffset(height), 1 + Math.random() * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function generateCaptchaImage(text) {
  const width = 400;
  const height = 150;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, width, height);

  drawNoise(ctx, width, height);

  const charWidth = width / (text.length + 1);
  for (let i = 0; i < text.length; i++) {
    ctx.save();
    const x = charWidth * (i + 0.5) + randomOffset(20) - 10;
    const y = height / 2 + randomOffset(30) - 15;
    ctx.translate(x, y);
    ctx.rotate(randomRotation());
    ctx.font = `bold ${48 + randomOffset(16)}px DejaVu Sans`;
    ctx.fillStyle = randomColor();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }

  drawDots(ctx, width, height);

  return canvas.toBuffer('image/png');
}

module.exports = {
  generateCaptchaText,
  generateCaptchaImage,
};
