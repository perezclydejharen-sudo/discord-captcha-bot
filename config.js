class VerificationConfig {
  constructor() {
    this.configs = new Map(); // guildId -> { verifiedRoleId, unverifiedRoleId, channelId, messageId }
  }

  setConfig(guildId, verifiedRoleId, unverifiedRoleId) {
    this.configs.set(guildId, { verifiedRoleId, unverifiedRoleId });
  }

  getConfig(guildId) {
    return this.configs.get(guildId);
  }

  hasConfig(guildId) {
    return this.configs.has(guildId);
  }
}

module.exports = { VerificationConfig };
