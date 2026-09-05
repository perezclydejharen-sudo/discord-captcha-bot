const { generateCaptchaText, generateCaptchaImage } = require('./captcha');
const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

const CAPTCHA_TIMEOUT = 2 * 60 * 1000; // 2 minutes

class CaptchaSessionManager {
  constructor() {
    this.sessions = new Map();
    this.pendingVerifications = new Set();
  }

  createSession(userId) {
    if (this.pendingVerifications.has(userId)) {
      return { error: 'pending' };
    }

    const existing = this.sessions.get(userId);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const text = generateCaptchaText(6);
    const imageBuffer = generateCaptchaImage(text);
    const attachment = new AttachmentBuilder(imageBuffer, { name: 'captcha.png' });

    const timer = setTimeout(() => {
      this.sessions.delete(userId);
      this.pendingVerifications.delete(userId);
    }, CAPTCHA_TIMEOUT);

    this.sessions.set(userId, {
      text,
      attachment,
      timer,
      createdAt: Date.now(),
    });

    this.pendingVerifications.add(userId);

    return { text, attachment };
  }

  verifyAnswer(userId, answer) {
    const session = this.sessions.get(userId);
    if (!session) {
      return { error: 'expired' };
    }

    if (Date.now() - session.createdAt > CAPTCHA_TIMEOUT) {
      clearTimeout(session.timer);
      this.sessions.delete(userId);
      this.pendingVerifications.delete(userId);
      return { error: 'expired' };
    }

    if (answer.trim().toLowerCase() === session.text.toLowerCase()) {
      clearTimeout(session.timer);
      this.sessions.delete(userId);
      this.pendingVerifications.delete(userId);
      return { success: true };
    }

    // Incorrect — generate a new captcha for retry
    clearTimeout(session.timer);
    this.sessions.delete(userId);
    this.pendingVerifications.delete(userId);

    return { success: false, retry: true };
  }

  clearSession(userId) {
    const session = this.sessions.get(userId);
    if (session) {
      clearTimeout(session.timer);
      this.sessions.delete(userId);
    }
    this.pendingVerifications.delete(userId);
  }

  hasSession(userId) {
    return this.sessions.has(userId);
  }

  isPending(userId) {
    return this.pendingVerifications.has(userId);
  }

  clearAll() {
    for (const [, session] of this.sessions) {
      clearTimeout(session.timer);
    }
    this.sessions.clear();
    this.pendingVerifications.clear();
  }
}

module.exports = { CaptchaSessionManager };
