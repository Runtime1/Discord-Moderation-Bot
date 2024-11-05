const { Client, GatewayIntentBits, Events, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Load configuration
const configPath = path.join(__dirname, 'config.json');
let config;
try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
    console.error('Error loading config file:', error);
    process.exit(1);
}

// Validate essential configuration
if (!process.env.BOT_TOKEN) {
    console.error('BOT_TOKEN is not set in the environment variables.');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Configuration
const PREFIX = config.prefix;
const MOD_LOG_CHANNEL_ID = config.modLogChannelId;
const MODERATOR_ROLE_ID = config.moderatorRoleId;
const WARNING_LIMIT = config.warningLimit;
const BLACKLIST = new Set(config.blacklist);
const userWarnings = {};
const inappropriateWords = config.inappropriateWords;
const AUTO_MOD_ACTIONS = {
    DELETE: 'delete',
    WARN: 'warn',
    TIMEOUT: 'timeout'
};
const commandCooldowns = new Map();
const messageCache = new Map();
const SPAM_THRESHOLD = config.spamThreshold;
const SPAM_TIME_FRAME = config.spamTimeFrame;
const RAID_THRESHOLD = config.raidThreshold;
const RAID_TIME_FRAME = config.raidTimeFrame;
const recentJoins = [];

// Function to update configuration
async function updateConfig(message, args) {
    if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

    if (args.length < 2) return message.reply('Please provide a key and value to update.');

    const [key, ...valueArr] = args;
    const value = valueArr.join(' ');

    try {
        if (key in config) {
            config[key] = isNaN(value) ? value : Number(value);
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            message.reply(`Configuration updated: ${key} = ${value}`);
        } else {
            message.reply('Invalid configuration key.');
        }
    } catch (error) {
        console.error('Error updating config:', error);
        message.reply('An error occurred while updating the configuration.');
    }
}

// Bot ready
client.once(Events.ClientReady, () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// Error handling
client.on('error', (error) => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Raid protection
client.on(Events.GuildMemberAdd, async (member) => {
    const now = Date.now();
    recentJoins.push(now);
    recentJoins.filter(timestamp => now - timestamp < RAID_TIME_FRAME);

    if (recentJoins.length >= RAID_THRESHOLD) {
        // Raid detected
        await member.guild.setVerificationLevel(4); // Set to highest verification level
        const logChannel = member.guild.channels.cache.get(MOD_LOG_CHANNEL_ID);
        if (logChannel) {
            await logChannel.send('Raid detected! Verification level set to highest.');
        }
    }
});

// Message reception
client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;

    try {
        // Anti-spam check
        if (isSpam(message)) {
            await message.delete();
            await message.member.timeout(config.spamTimeout || 60000, 'Spamming');
            logModerationAction(message, 'User timed out for spamming');
            return;
        }

        // Auto-moderation for inappropriate content
        const autoModResult = await autoModerate(message);
        if (autoModResult) {
            logModerationAction(message, `Auto-moderation: ${autoModResult}`);
        }

        // Command processing
        if (message.content.startsWith(PREFIX)) {
            const args = message.content.slice(PREFIX.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            // Check if the user is a moderator and skip cooldown
            const isAdmin = isModerator(message.member);

            if (!isAdmin && commandCooldowns.has(message.author.id)) {
                return message.reply('Please wait before using another command.');
            }

            const commands = {
                warn: warnUser,
                unwarn: unwarnUser,
                mute: muteUser,
                unmute: unmuteUser,
                ban: banUser,
                unban: unbanUser,
                softban: softbanUser,
                timeout: timeoutUser,
                untimeout: untimeoutUser,
                blacklist: blacklistUser,
                unblacklist: unblacklistUser,
                kick: kickUser,
                clear: clearMessages,
                warnings: showWarnings,
                addrole: addRole,
                removerole: removeRole,
                slowmode: setSlowmode,
                poll: createPoll,
                serverinfo: showServerInfo,
                userinfo: showUserInfo,
                rules: showRules,
                viewblacklist: viewBlacklist,
                help: showHelp,
                kickall: kickAll,
                muteall: muteAll,
                exportlogs: exportModerationLogs,
                config: updateConfig
            };

            if (command in commands) {
                await commands[command](message, args);
            } else {
                message.channel.send('Unknown command.');
            }

            // Set cooldown for the command if user is not an admin
            if (!isAdmin) {
                commandCooldowns.set(message.author.id, true);
                setTimeout(() => {
                    commandCooldowns.delete(message.author.id);
                }, config.commandCooldown || 5000);
            }
        }
    } catch (error) {
        console.error('Error processing message:', error);
        message.reply('An error occurred while processing your command.');
    }
});

// Function to export moderation logs
async function exportModerationLogs(message, args) {
    if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

    const logChannel = message.guild.channels.cache.get(MOD_LOG_CHANNEL_ID);
    if (!logChannel) return message.reply('Log channel not found.');

    try {
        const logs = await logChannel.messages.fetch({ limit: 100 });
        const logEmbeds = logs.filter(msg => msg.embeds.length > 0).map(msg => msg.embeds[0]);

        if (logEmbeds.length === 0) {
            return message.reply('No moderation logs found.');
        }

        const exportEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Moderation Logs Export')
            .setDescription(`Exported ${logEmbeds.length} log entries.`)
            .setTimestamp();

        await message.channel.send({ embeds: [exportEmbed, ...logEmbeds] });
    } catch (error) {
        console.error('Error exporting moderation logs:', error);
        message.reply('An error occurred while exporting moderation logs.');
    }
}

// Function to update configuration
async function updateConfig(message, args) {
    if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

    if (args.length < 2) return message.reply('Please provide a key and value to update.');

    const [key, ...valueArr] = args;
    const value = valueArr.join(' ');

    try {
        if (key in config) {
            config[key] = isNaN(value) ? value : Number(value);
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            message.reply(`Configuration updated: ${key} = ${value}`);
        } else {
            message.reply('Invalid configuration key.');
        }
    } catch (error) {
        console.error('Error updating config:', error);
        message.reply('An error occurred while updating the configuration.');
    }
}

// Function to check for inappropriate content
function containsInappropriateContent(content, authorId) {
    return inappropriateWords.some(word => content.includes(word)) || BLACKLIST.has(authorId);
}

// Functions for moderation actions
async function warnUser (message, args) {
    if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

    const user = message.mentions.members.first();
    if (!user) return message.reply ('Please mention a user.');

    if (!userWarnings[user.id]) {
        userWarnings[user.id] = 0;
    }
    userWarnings[user.id]++;

    const warningCount = userWarnings[user.id];
    await logModerationAction(message, `Warned ${user.user.tag}. Total warnings: ${warningCount}`);

    // Send DM to the user
    const warnEmbed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('Warning')
        .setDescription(`You have been warned in **${message.guild.name}**.\nTotal warnings: ${warningCount}.`);

    await user.send({ embeds: [warnEmbed] });

    if (warningCount >= WARNING_LIMIT) {
        await timeoutUser (message, [user.id, '60s']); // Timeout for 60 seconds
    }
}

async function unwarnUser  (message, args) {
    if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

    const user = message.mentions.members.first();
    if (!user) return message.reply('Please mention a user.');

    if (userWarnings[user.id] > 0) {
        userWarnings[user.id]--;
        await logModerationAction(message, `Unwarned ${user.user.tag}. Remaining warnings: ${userWarnings[user.id]}`);
        
        // Send DM to the user
        const unwarnEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('Warning Removed')
            .setDescription(`A warning has been removed from you in **${message.guild.name}**.\nRemaining warnings: ${userWarnings[user.id]}.`);

        await user.send({ embeds: [unwarnEmbed] });
    } else {
        message.reply('This user has no warnings to remove.');
    }
}

async function muteUser(message, args) {
    try {
        if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

        const user = message.mentions.members.first();
        if (!user) return message.reply('Please mention a user.');

        // Check if the user is in a voice channel
        if (!user.voice.channel) {
            return message.reply(`${user.user.tag} is not connected to a voice channel.`);
        }

        await user.voice.setMute(true);
        await logModerationAction(message, 'Muted', user.user);

        // Send DM to the user
        const muteEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Muted')
            .setDescription(`You have been muted in **${message.guild.name}**.`);

        await user.send({ embeds: [muteEmbed] });

        message.reply(`${user.user.tag} has been muted.`);
    } catch (error) {
        console.error('Error in muteUser:', error);
        message.reply('An error occurred while trying to mute the user.');
    }
}

async function unmuteUser(message, args) {
    try {
        if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

        const user = message.mentions.members.first();
        if (!user) return message.reply('Please mention a user.');

        // Check if the user is in a voice channel
        if (!user.voice.channel) {
            return message.reply(`${user.user.tag} is not connected to a voice channel.`);
        }

        await user.voice.setMute(false);
        await logModerationAction(message, 'Unmuted', user.user);

        // Send DM to the user
        const unmuteEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('Unmuted')
            .setDescription(`You have been unmuted in **${message.guild.name}**.`);

        await user.send({ embeds: [unmuteEmbed] });

        message.reply(`${user.user.tag} has been unmuted.`);
    } catch (error) {
        console.error('Error in unmuteUser:', error);
        message.reply('An error occurred while trying to unmute the user.');
    }
}

async function banUser(message, args) {
    try {
        if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

        const user = message.mentions.members.first();
        if (!user) return message.reply('Please mention a user.');

        await user.ban();
        await logModerationAction(message, 'Banned', user.user);

        // Send DM to the user
        const banEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Banned')
            .setDescription(`You have been banned from **${message.guild.name}**.`);

        await user.send({ embeds: [banEmbed] });

        message.reply(`${user.user.tag} has been banned.`);
    } catch (error) {
        console.error('Error in banUser:', error);
        message.reply('An error occurred while trying to ban the user.');
    }
}

async function softbanUser(message, args) {
    try {
        if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

        const user = message.mentions.members.first();
        if (!user) return message.reply('Please mention a user.');

        await user.ban({ days: 7 });
        await message.guild.members.unban(user.id);
        await logModerationAction(message, 'Softbanned', user.user);

        // Send DM to the user
        const softbanEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Softbanned')
            .setDescription(`You have been softbanned from **${message.guild.name}**. You can rejoin the server.`);

        await user.send({ embeds: [softbanEmbed] });

        message.reply(`${user.user.tag} has been softbanned.`);
    } catch (error) {
        console.error('Error in softbanUser:', error);
        message.reply('An error occurred while trying to softban the user.');
    }
}

async function unbanUser(message, args) {
    try {
        if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

        const userId = args[0];
        if (!userId) return message.reply('Please provide a user ID.');

        const user = await client.users.fetch(userId);
        await message.guild.members.unban(userId);
        await logModerationAction(message, 'Unbanned', user);

        // Send DM to the user
        const unbanEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('Unbanned')
            .setDescription(`You have been unbanned from **${message.guild.name}**.`);

        await user.send({ embeds: [unbanEmbed] });

        message.reply(`${user.tag} has been unbanned.`);
    } catch (error) {
        console.error('Error in unbanUser:', error);
        message.reply('An error occurred while trying to unban the user. Please check the user ID.');
    }
}

async function timeoutUser(message, args) {
    try {
        if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

        const user = message.mentions.members.first();
        if (!user) return message.reply('Please mention a user.');

        const duration = args[1];
        if (!duration) return message.reply('Please specify a duration (e.g., 60s, 5m, 1h).');

        const parsedDuration = parseDuration(duration);
        if (parsedDuration === 0) return message.reply('Invalid duration format.');

        await user.timeout(parsedDuration);
        await logModerationAction(message, `Timed out for ${duration}`, user.user);

        // Send DM to the user
        const timeoutEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Timed Out')
            .setDescription(`You have been timed out in **${message.guild.name}** for ${duration}.`);

        await user.send({ embeds: [timeoutEmbed] });

        message.reply(`${user.user.tag} has been timed out for ${duration}.`);
    } catch (error) {
        console.error('Error in timeoutUser:', error);
        message.reply('An error occurred while trying to timeout the user.');
    }
}

async function untimeoutUser(message, args) {
    try {
        if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

        const user = message.mentions.members.first();
        if (!user) return message.reply('Please mention a user.');

        await user.timeout(null); // Remove timeout
        await logModerationAction(message, 'Timeout removed', user.user);

        // Send DM to the user
        const untimeoutEmbed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('Timeout Removed')
            .setDescription(`Your timeout has been removed in **${message.guild.name}**.`);

        await user.send({ embeds: [untimeoutEmbed] });

        message.reply(`Timeout has been removed for ${user.user.tag}.`);
    } catch (error) {
        console.error('Error in untimeoutUser:', error);
        message.reply('An error occurred while trying to remove the timeout from the user.');
    }
}

async function blacklistUser(message, args) {
    try {
        if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

        const user = message.mentions.members.first();
        if (!user) return message.reply('Please mention a user.');

        BLACKLIST.add(user.id);
        await logModerationAction(message, 'Blacklisted', user.user);

        // Send DM to the user
        const blacklistEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Blacklisted')
            .setDescription(`You have been blacklisted from **${message.guild.name}**.`);

        await user.send({ embeds: [blacklistEmbed] });

        message.reply(`${user.user.tag} has been blacklisted.`);
    } catch (error) {
        console.error('Error in blacklistUser:', error);
        message.reply('An error occurred while trying to blacklist the user.');
    }
}

async function unblacklistUser(message, args) {
    try {
        if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

        const user = message.mentions.members.first();
        if (!user) return message.reply('Please mention a user.');

        if (BLACKLIST.has(user.id)) {
            BLACKLIST.delete(user.id);
            await logModerationAction(message, 'Unblacklisted', user.user);

            // Send DM to the user
            const unblacklistEmbed = new EmbedBuilder()
                .setColor('#00FF00')
                .setTitle('Unblacklisted')
                .setDescription(`You have been removed from the blacklist in **${message.guild.name}**.`);

            await user.send({ embeds: [unblacklistEmbed] });

            message.reply(`${user.user.tag} has been removed from the blacklist.`);
        } else {
            message.reply(`${user.user.tag} is not in the blacklist.`);
        }
    } catch (error) {
        console.error('Error in unblacklistUser:', error);
        message.reply('An error occurred while trying to unblacklist the user.');
    }
}

// Other existing functions remain unchanged...

async function kickUser (message, args) {
    try {
        if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

        const user = message.mentions.members.first();
        if (!user) return message.reply('Please mention a user.');

        await user.kick();
        await logModerationAction(message, 'Kicked', user.user);

        // Send DM to the user
        const kickEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('Kicked')
            .setDescription(`You have been kicked from **${message.guild.name}**.`);

        await user.send({ embeds: [kickEmbed] });

        message.reply(`${user.user.tag} has been kicked.`);
    } catch (error) {
        console.error('Error in kickUser:', error);
        message.reply('An error occurred while trying to kick the user.');
    }
}

async function clearMessages(message, args) {
    if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

    const amount = parseInt(args[0]) || 100; // Default to 100 messages
    await message.channel.bulkDelete(amount, true);
    await logModerationAction(message, `Cleared ${amount} messages.`);
}

async function showWarnings(message, args) {
    const user = message.mentions.members.first() || message.member;
    const warnings = userWarnings[user.id] || 0;
    message.channel.send(`${user.user.tag} has ${warnings} warnings.`);
}

async function addRole(message, args) {
    if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

    const user = message.mentions.members.first();
    const role = message.guild.roles.cache.find(r => r.name === args[ 1]);

    if (!user || !role) return message.reply('Please mention a user and specify a role.');

    await user.roles.add(role);
    await logModerationAction(message, `Added role ${role.name} to ${user.user.tag}`);
    message.channel.send(`Role ${role.name} has been added to ${user.user.tag}.`);
}

async function removeRole(message, args) {
    if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

    const user = message.mentions.members.first();
    const role = message.guild.roles.cache.find(r => r.name === args[1]);

    if (!user || !role) return message.reply('Please mention a user and specify a role.');

    await user.roles.remove(role);
    await logModerationAction(message, `Removed role ${role.name} from ${user.user.tag}`);
    message.channel.send(`Role ${role.name} has been removed from ${user.user.tag}.`);
}

async function setSlowmode(message, args) {
    if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

    const time = parseInt(args[0]) || 0; // Default to 0 seconds
    await message.channel.setRateLimitPerUser (time);
    await logModerationAction(message, `Set slowmode to ${time} seconds in ${message.channel.name}`);
    message.channel.send(`Slowmode has been set to ${time} seconds.`);
}

async function createPoll(message, args) {
    const pollQuestion = args.join(' ');
    if (!pollQuestion) return message.reply('Please provide a question for the poll.');

    const pollEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('Poll')
        .setDescription(pollQuestion)
        .setFooter('React with 👍 for Yes or 👎 for No');

    const pollMessage = await message.channel.send({ embeds: [pollEmbed] });
    await pollMessage.react('👍');
    await pollMessage.react('👎');
}

async function showServerInfo(message) {
    const serverInfoEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('Server Information')
        .addFields(
            { name: 'Server Name', value: message.guild.name, inline: true },
            { name: 'Total Members', value: message.guild.memberCount.toString(), inline: true },
            { name: 'Created On', value: message.guild.createdAt.toDateString(), inline: true }
        );

    message.channel.send({ embeds: [serverInfoEmbed] });
}

async function showUserInfo(message, args) {
    const user = message.mentions.members.first() || message.member;
    const userInfoEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('User  Information')
        .addFields(
            { name: 'Username', value: user.user.tag, inline: true },
            { name: 'Joined Server', value: user.joinedAt.toDateString(), inline: true },
            { name: 'Account Created', value: user.user.createdAt.toDateString(), inline: true }
        );

    message.channel.send({ embeds: [userInfoEmbed] });
}

async function showRules(message) {
    const rulesEmbed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('Server Rules')
        .setDescription('1. Be respectful.\n2. No spamming.\n3. Follow Discord TOS.');

    message.channel.send({ embeds: [rulesEmbed] });
}

async function viewBlacklist(message) {
    const blacklistArray = Array.from(BLACKLIST);
    const blacklistEmbed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle('Blacklisted Users')
        .setDescription(blacklistArray.length > 0 ? blacklistArray.join('\n') : 'No users are blacklisted.');

    message.channel.send({ embeds: [blacklistEmbed] });
}

async function showHelp(message) {
    const helpEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Bot Commands')
        .setDescription('Here are the available commands:')
        .addFields(
            { name: 'Moderation', value: 'warn, unwarn, mute, unmute, ban, unban, softban, timeout, untimeout, blacklist, unblacklist, kick, clear' },
            { name: 'Information', value: 'warnings, serverinfo, userinfo, rules, viewblacklist' },
            { name: 'Utility', value: 'addrole, removerole, slowmode, poll' },
            { name: 'Admin', value: 'kickall, muteall, exportlogs, config' },
            { name: 'Configuration', value: 'Use the `config` command to update bot settings. Example: `.config spamThreshold 10`' },
            { name: 'Export Logs', value: 'Use the `exportlogs` command to export the last 100 moderation log entries as embeds.' }
        );

    message.channel.send({ embeds: [helpEmbed] });
}

function isSpam(message) {
    if (!messageCache.has(message.author.id)) {
        messageCache.set(message.author.id, []);
    }

    const userMessages = messageCache.get(message.author.id);
    const now = Date.now();
    const recentMessages = userMessages.filter(msg => now - msg.timestamp < SPAM_TIME_FRAME);

    recentMessages.push({
        content: message.content,
        timestamp: now
    });

    messageCache.set(message.author.id, recentMessages);

    const similarMessages = recentMessages.filter(msg => msg.content === message.content);
    return similarMessages.length > SPAM_THRESHOLD;
}

async function kickAll(message) {
    if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

    const members = message.guild.members.cache.filter(member => !member.user.bot);
    for (const member of members.values()) {
        await member.kick();
        await logModerationAction(message, `Kicked ${member.user.tag}`);
    }
    message.channel.send('All members have been kicked.');
}

async function muteAll(message) {
    if (!isModerator(message.member)) return message.reply('You do not have permission to execute this command.');

    const members = message.guild.members.cache.filter(member => !member.user.bot);
    for (const member of members.values()) {
        await member.voice.setMute(true);
        await logModerationAction(message, `Muted ${member.user.tag}`);
    }
    message.channel.send('All members have been muted.');
}

async function autoModerate(message) {
    const lowercaseContent = message.content.toLowerCase();
    for (const word of inappropriateWords) {
        if (lowercaseContent.includes(word.toLowerCase())) {
            const action = determineAction(message.author.id);
            switch (action) {
                case AUTO_MOD_ACTIONS.DELETE:
                    await message.delete();
                    return 'Deleted message containing inappropriate content';
                case AUTO_MOD_ACTIONS.WARN:
                    await warnUser(message, [message.author]);
                    return 'Warned user for inappropriate content';
                case AUTO_MOD_ACTIONS.TIMEOUT:
                    await timeoutUser(message, [message.author, '5m']);
                    return 'Timed out user for inappropriate content';
            }
        }
    }
    return null;
}

function determineAction(userId) {
    const warningCount = userWarnings[userId] || 0;
    if (warningCount >= 3) {
        return AUTO_MOD_ACTIONS.TIMEOUT;
    } else if (warningCount >= 1) {
        return AUTO_MOD_ACTIONS.WARN;
    } else {
        return AUTO_MOD_ACTIONS.DELETE;
    }
}

// Utility function to check if a user is a moderator
function isModerator(member) {
    return member.roles.cache.has(MODERATOR_ROLE_ID);
}

// Utility function to log moderation actions
async function logModerationAction(message, action, target = null) {
    const logChannel = message.guild.channels.cache.get(MOD_LOG_CHANNEL_ID);
    if (logChannel) {
        const logEmbed = new EmbedBuilder()
            .setColor('#FF9900')
            .setTitle('Moderation Action')
            .addFields(
                { name: 'Moderator', value: message.author.tag, inline: true },
                { name: 'Action', value: action, inline: true },
                { name: 'Target', value: target ? target.tag : 'N/A', inline: true },
                { name: 'Channel', value: message.channel.name, inline: true },
                { name: 'Time', value: new Date().toUTCString(), inline: true }
            );

        if (message.content) {
            logEmbed.addFields({ name: 'Message Content', value: message.content });
        }

        await logChannel.send({ embeds: [logEmbed] });
    }
}

// Utility function to parse duration strings (e.g., "60s", "2m")
function parseDuration(duration) {
    const time = parseInt(duration.slice(0, -1));
    const unit = duration.slice(-1);
    switch (unit) {
        case 's':
            return time * 1000; // seconds
        case 'm':
            return time * 60 * 1000; // minutes
        case 'h':
            return time * 60 * 60 * 1000; // hours
        default:
            return 0; // default to 0 if invalid
    }
}

// Test function to simulate various scenarios
async function testModeration(message) {
    console.log('Starting moderation test...');

    // Test anti-spam
    for (let i = 0; i < 6; i++) {
        await client.emit('messageCreate', {
            ...message,
            content: 'Spam message',
            author: { ...message.author, bot: false },
            delete: async () => console.log('Message deleted (spam)'),
            member: { ...message.member, timeout: async () => console.log('User timed out (spam)') }
        });
    }

    // Test auto-moderation
    await client.emit('messageCreate', {
        ...message,
        content: 'This message contains badWord1',
        author: { ...message.author, bot: false },
        delete: async () => console.log('Message deleted (inappropriate content)')
    });

    // Test moderation commands
    const testUser = { ...message.mentions.members.first(), ban: async () => {}, kick: async () => {}, send: async () => {} };
    
    await warnUser({ ...message, mentions: { members: { first: () => testUser } } }, []);
    await banUser({ ...message, mentions: { members: { first: () => testUser } } }, []);
    await kickUser({ ...message, mentions: { members: { first: () => testUser } } }, []);
    await softbanUser({ ...message, mentions: { members: { first: () => testUser } } }, []);

    console.log('Moderation test completed.');
}

// Add test command
client.on('messageCreate', async (message) => {
    if (message.content === '!test' && isModerator(message.member)) {
        await testModeration(message);
    }
});

// Log in the bot
client.login(config.token).catch(error => {
    console.error('Error logging in:', error);
    console.error('Please make sure you have set the correct bot token in the config.json file.');
    process.exit(1);
});
