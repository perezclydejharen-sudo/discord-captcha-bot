require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  Events,
} = require('discord.js');

const { VerificationConfig } = require('./config');
const { CaptchaSessionManager } = require('./session');
const { generateCaptchaText, generateCaptchaImage } = require('./captcha');
const { AttachmentBuilder } = require('discord.js');
const http = require('http');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const verificationConfig = new VerificationConfig();
const captchaManager = new CaptchaSessionManager();

const VERIFICATION_MODAL_ID = 'captcha_verification_modal';
const CAPTCHA_INPUT_ID = 'captcha_answer_input';
const VERIFY_BUTTON_ID = 'verify_captcha_btn';

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);

  c.application.commands.create(
    new SlashCommandBuilder()
      .setName('verification')
      .setDescription('Set up the CAPTCHA verification system for this server')
      .addRoleOption((opt) =>
        opt
          .setName('verified_role')
          .setDescription('Role given after successful CAPTCHA verification')
          .setRequired(true)
      )
      .addRoleOption((opt) =>
        opt
          .setName('unverified_role')
          .setDescription('Role given to users who have not yet verified')
          .setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  ).catch((err) => {
    console.error('Failed to register slash command:', err);
  });
});

// Handle slash command
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'verification') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        await interaction.reply({
          content: 'You need Administrator permissions to use this command.',
          ephemeral: true,
        });
        return;
      }

      const verifiedRole = interaction.options.getRole('verified_role');
      const unverifiedRole = interaction.options.getRole('unverified_role');

      if (!verifiedRole || !unverifiedRole) {
        await interaction.reply({
          content: 'Both the Verified Role and Unverified Role are required.',
          ephemeral: true,
        });
        return;
      }

      if (verifiedRole.id === unverifiedRole.id) {
        await interaction.reply({
          content: 'The Verified Role and Unverified Role must be different.',
          ephemeral: true,
        });
        return;
      }

      // Check bot permissions
      const botMember = interaction.guild.members.me;
      if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
        await interaction.reply({
          content: 'I need the Manage Roles permission to assign and remove roles.',
          ephemeral: true,
        });
        return;
      }

      if (verifiedRole.position >= botMember.roles.highest.position || unverifiedRole.position >= botMember.roles.highest.position) {
        await interaction.reply({
          content: 'One or both roles are above my highest role. I cannot manage them. Please move my role above the selected roles.',
          ephemeral: true,
        });
        return;
      }

      // Store config (updates existing if already set)
      verificationConfig.setConfig(interaction.guild.id, verifiedRole.id, unverifiedRole.id);

      const embed = new EmbedBuilder()
        .setTitle('Verification')
        .setDescription('Complete the CAPTCHA to verify yourself and access the server.')
        .setColor(0x00b894)
        .setFooter({ text: 'Click the button below to start verification' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(VERIFY_BUTTON_ID)
          .setLabel('✅ Verify')
          .setStyle(ButtonStyle.Success)
      );

      await interaction.reply({
        embeds: [embed],
        components: [row],
      });
    }

    // Handle Verify button click
    else if (interaction.isButton() && interaction.customId === VERIFY_BUTTON_ID) {
      const config = verificationConfig.getConfig(interaction.guild.id);
      if (!config) {
        await interaction.reply({
          content: 'Verification has not been configured for this server. An administrator needs to run `/verification` first.',
          ephemeral: true,
        });
        return;
      }

      const member = interaction.member;

      // If already verified, don't make them verify again
      if (member.roles.cache.has(config.verifiedRoleId)) {
        await interaction.reply({
          content: 'You are already verified!',
          ephemeral: true,
        });
        return;
      }

      // Prevent spam — if already pending
      if (captchaManager.isPending(interaction.user.id)) {
        await interaction.reply({
          content: 'You already have a pending CAPTCHA. Please complete it or wait for it to expire (2 minutes).',
          ephemeral: true,
        });
        return;
      }

      // Create captcha session
      const result = captchaManager.createSession(interaction.user.id);
      if (result.error === 'pending') {
        await interaction.reply({
          content: 'You already have a pending CAPTCHA. Please complete it or wait for it to expire (2 minutes).',
          ephemeral: true,
        });
        return;
      }

      const captchaEmbed = new EmbedBuilder()
        .setTitle('CAPTCHA Verification')
        .setDescription('Enter the text shown in the image below. The CAPTCHA is case-insensitive and expires in 2 minutes.')
        .setColor(0x0984e3)
        .setImage('attachment://captcha.png')
        .setFooter({ text: 'This CAPTCHA is unique to you — do not share it' });

      await interaction.reply({
        embeds: [captchaEmbed],
        files: [result.attachment],
        ephemeral: true,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('open_captcha_modal')
              .setLabel('Type Answer')
              .setStyle(ButtonStyle.Primary)
          ),
        ],
      });
    }

    // Handle "Type Answer" button — opens the modal
    else if (interaction.isButton() && interaction.customId === 'open_captcha_modal') {
      if (!captchaManager.hasSession(interaction.user.id)) {
        await interaction.reply({
          content: 'Your CAPTCHA has expired. Please click the Verify button again to get a new one.',
          ephemeral: true,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(VERIFICATION_MODAL_ID)
        .setTitle('Enter CAPTCHA Answer');

      const input = new TextInputBuilder()
        .setCustomId(CAPTCHA_INPUT_ID)
        .setLabel('Type the text you see in the CAPTCHA image')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter the CAPTCHA text here')
        .setRequired(true)
        .setMaxLength(20);

      modal.addComponents(new ActionRowBuilder().addComponents(input));

      await interaction.showModal(modal);
    }

    // Handle modal submission
    else if (interaction.isModalSubmit() && interaction.customId === VERIFICATION_MODAL_ID) {
      const answer = interaction.fields.getTextInputValue(CAPTCHA_INPUT_ID);
      const config = verificationConfig.getConfig(interaction.guild.id);

      if (!config) {
        await interaction.reply({
          content: 'Verification is no longer configured for this server.',
          ephemeral: true,
        });
        return;
      }

      const result = captchaManager.verifyAnswer(interaction.user.id, answer);

      if (result.error === 'expired') {
        await interaction.reply({
          content: 'Your CAPTCHA has expired. Please click the Verify button again to get a new one.',
          ephemeral: true,
        });
        return;
      }

      if (result.success) {
        try {
          const member = interaction.member;
          const verifiedRole = interaction.guild.roles.cache.get(config.verifiedRoleId);
          const unverifiedRole = interaction.guild.roles.cache.get(config.unverifiedRoleId);

          if (!verifiedRole) {
            await interaction.reply({
              content: 'The verified role no longer exists. Please ask an administrator to reconfigure verification.',
              ephemeral: true,
            });
            return;
          }

          // Remove unverified role if present
          if (unverifiedRole && member.roles.cache.has(unverifiedRole.id)) {
            await member.roles.remove(unverifiedRole);
          }

          // Add verified role
          if (!member.roles.cache.has(verifiedRole.id)) {
            await member.roles.add(verifiedRole);
          }

          await interaction.reply({
            content: '✅ Verification successful! You now have access to the server.',
            ephemeral: true,
          });
        } catch (err) {
          console.error('Error assigning roles after verification:', err);
          await interaction.reply({
            content: 'Verification was correct, but I encountered an error assigning roles. Please contact an administrator.',
            ephemeral: true,
          });
        }
      } else if (result.retry) {
        // Incorrect — generate a new captcha and let them try again
        const newResult = captchaManager.createSession(interaction.user.id);
        const retryEmbed = new EmbedBuilder()
          .setTitle('Incorrect — Try Again')
          .setDescription('The answer you entered was incorrect. Here is a new CAPTCHA. It expires in 2 minutes.')
          .setColor(0xd63031)
          .setImage('attachment://captcha.png')
          .setFooter({ text: 'This CAPTCHA is unique to you — do not share it' });

        await interaction.reply({
          embeds: [retryEmbed],
          files: [newResult.attachment],
          ephemeral: true,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId('open_captcha_modal')
                .setLabel('Type Answer')
                .setStyle(ButtonStyle.Primary)
            ),
          ],
        });
      }
    }
  } catch (err) {
    console.error('Interaction error:', err);
    const payload = {
      content: 'An unexpected error occurred. Please try again.',
      ephemeral: true,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

// When a new member joins, give them the unverified role
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const config = verificationConfig.getConfig(member.guild.id);
    if (!config) return;

    const unverifiedRole = member.guild.roles.cache.get(config.unverifiedRoleId);
    if (!unverifiedRole) return;

    const botMember = member.guild.members.me;
    if (!botMember || !botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return;
    if (unverifiedRole.position >= botMember.roles.highest.position) return;

    await member.roles.add(unverifiedRole);
  } catch (err) {
    console.error('Error assigning unverified role on member join:', err);
  }
});

// Health check server for Railway
const PORT = process.env.PORT || 3000;
const healthServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    status: 'ok',
    ready: client.isReady(),
    uptime: process.uptime(),
  }));
});

healthServer.listen(PORT, () => {
  console.log(`Health check server listening on port ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error('Failed to login:', err);
});

// Clean up sessions on shutdown
process.on('SIGINT', () => {
  captchaManager.clearAll();
  healthServer.close();
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  captchaManager.clearAll();
  healthServer.close();
  client.destroy();
  process.exit(0);
});
