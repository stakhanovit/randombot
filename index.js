
const { Client, GatewayIntentBits, Events } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences
    ]
});

const CHANNELS = {
    STATIC_AVATAR: '1445884129043415080',  
    GIF_AVATAR: '1445884170814361731',     
    BANNER_CHANGE: '1445884208970076321',
    USERNAME_CHANGE: '1478232755635617983',
    NICKNAME_CHANGE: '1478232755635617983'   
};

const userCache = new Map();
let allGuildMembers = new Set();

function isGif(url) {
    return url && (url.includes('.gif') || url.includes('a_'));
}

async function sendNotification(channelId, user, changeType, oldValue, newValue) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
            const embed = {
                color: 0x9c41ff,
                footer: {
                    text: `GIFZADA - ${user.username}(${user.id})`,
                    icon_url: channel.guild.iconURL({ size: 128 })
                }
            };

          
            if (changeType.includes('Banner')) {
                if (newValue !== 'None') {
                    embed.image = { url: newValue };
                }
            } else if (changeType.includes('Avatar')) {
                embed.image = { url: user.displayAvatarURL({ size: 512 }) };
            }

            const message = await channel.send({ embeds: [embed] });
            console.log(`✅ ${changeType} notification sent for ${user.tag} in ${channel.name}`);
        }
    } catch (error) {
        console.error(`❌ Failed to send ${changeType} notification for ${user.tag}:`, error.message);
        if (error.code === 50013) {
            console.error(`Bot needs Send Messages permission in channel ${channelId}`);
        }
    }
}

async function sendUsernameNotification(channelId, user, oldUsername, newUsername) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
            const embed = {
                color: 0x9c41ff,
                description: `username disponível: \`${oldUsername}\``,
                footer: {
                    text: `GIFZADA - ${user.username}(${user.id})`,
                    icon_url: channel.guild.iconURL({ size: 128 })
                }
            };

            await channel.send({ embeds: [embed] });
            console.log(`✅ Username notification sent for ${user.tag}: ${oldUsername} is now available`);
        }
    } catch (error) {
        console.error(`❌ Failed to send username notification for ${user.tag}:`, error.message);
        if (error.code === 50013) {
            console.error(`Bot needs Send Messages permission in channel ${channelId}`);
        }
    }
}

async function sendNicknameNotification(channelId, member, oldNickname, newNickname) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
            const embed = {
                color: 0x9c41ff,
                description: `nickname disponível: \`${oldNickname}\``,
                footer: {
                    text: `GIFZADA - ${member.user.username}(${member.user.id})`,
                    icon_url: channel.guild.iconURL({ size: 128 })
                }
            };

            await channel.send({ embeds: [embed] });
            console.log(`✅ Nickname notification sent for ${member.user.tag}: ${oldNickname} is now available`);
        }
    } catch (error) {
        console.error(`❌ Failed to send nickname notification for ${member.user.tag}:`, error.message);
        if (error.code === 50013) {
            console.error(`Bot needs Send Messages permission in channel ${channelId}`);
        }
    }
}

async function sendDisplayNameNotification(channelId, user, oldDisplayName, newDisplayName) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
            const embed = {
                color: 0x9c41ff,
                description: `display name disponível: \`${oldDisplayName}\``,
                footer: {
                    text: `GIFZADA - ${user.username}(${user.id})`,
                    icon_url: channel.guild.iconURL({ size: 128 })
                }
            };

            await channel.send({ embeds: [embed] });
            console.log(`✅ Display Name notification sent for ${user.tag}: ${oldDisplayName} is now available`);
        }
    } catch (error) {
        console.error(`❌ Failed to send display name notification for ${user.tag}:`, error.message);
        if (error.code === 50013) {
            console.error(`Bot needs Send Messages permission in channel ${channelId}`);
        }
    }
}

async function checkUserChanges(userId) {
    try {
        const fullUser = await client.users.fetch(userId, { force: true });
        const cached = userCache.get(userId);
        
        if (!cached) {
            userCache.set(userId, {
                avatar: fullUser.avatar,
                banner: fullUser.banner,
                username: fullUser.username,
                displayName: fullUser.displayName
            });
            return;
        }

        // Check avatar changes
        if (cached.avatar !== fullUser.avatar) {
            console.log(`🎭 Avatar change detected for ${fullUser.tag}: ${cached.avatar || 'None'} → ${fullUser.avatar || 'None'}`);

            // Só envia notificação se o novo avatar não for None (null)
            if (fullUser.avatar) {
                const oldAvatarUrl = cached.avatar ? 
                    `https://cdn.discordapp.com/avatars/${fullUser.id}/${cached.avatar}${cached.avatar.startsWith('a_') ? '.gif' : '.png'}` : 
                    'None';
                const newAvatarUrl = fullUser.displayAvatarURL({ size: 512 });

                if (isGif(fullUser.avatar)) {
                    await sendNotification(
                        CHANNELS.GIF_AVATAR, 
                        fullUser, 
                        'Avatar (GIF)', 
                        oldAvatarUrl, 
                        newAvatarUrl
                    );
                } else {
                    await sendNotification(
                        CHANNELS.STATIC_AVATAR, 
                        fullUser, 
                        'Avatar (Static)', 
                        oldAvatarUrl, 
                        newAvatarUrl
                    );
                }
            }

            cached.avatar = fullUser.avatar;
        }

        // Check banner changes
        if (cached.banner !== fullUser.banner) {
            console.log(`🎨 Banner change detected for ${fullUser.tag}: ${cached.banner || 'None'} → ${fullUser.banner || 'None'}`);

            // Só envia notificação se o novo banner não for None (null)
            if (fullUser.banner) {
                const oldBannerUrl = cached.banner ? 
                    `https://cdn.discordapp.com/banners/${fullUser.id}/${cached.banner}${cached.banner.startsWith('a_') ? '.gif' : '.png'}` : 
                    'None';
                const newBannerUrl = `https://cdn.discordapp.com/banners/${fullUser.id}/${fullUser.banner}${fullUser.banner.startsWith('a_') ? '.gif' : '.png'}?size=600`;

                const bannerType = isGif(fullUser.banner) ? 'Banner (GIF)' : 'Banner (Static)';

                await sendNotification(
                    CHANNELS.BANNER_CHANGE, 
                    fullUser, 
                    bannerType, 
                    oldBannerUrl, 
                    newBannerUrl
                );
            }

            cached.banner = fullUser.banner;
        }

        // Check username changes
        if (cached.username !== fullUser.username) {
            console.log(`👤 Username change detected for ${fullUser.id}: ${cached.username} → ${fullUser.username}`);

            await sendUsernameNotification(
                CHANNELS.USERNAME_CHANGE,
                fullUser,
                cached.username,
                fullUser.username
            );

            cached.username = fullUser.username;
        }

        // Check display name changes
        if (cached.displayName !== fullUser.displayName) {
            console.log(`🏷️ Display Name change detected for ${fullUser.id}: ${cached.displayName || 'None'} → ${fullUser.displayName || 'None'}`);

            // Send notification if old display name existed
            if (cached.displayName) {
                await sendDisplayNameNotification(
                    CHANNELS.USERNAME_CHANGE,
                    fullUser,
                    cached.displayName,
                    fullUser.displayName
                );
            }

            cached.displayName = fullUser.displayName;
        }
        
    } catch (error) {
        // Silenciar erros para não spam no console
    }
}

client.once(Events.ClientReady, async () => {
    console.log(`Bot logged in as ${client.user.tag}!`);

    // Carregar todos os membros do servidor
    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.members.fetch();
            guild.members.cache.forEach(member => {
                allGuildMembers.add(member.id);
                userCache.set(member.id, {
                    avatar: member.user.avatar,
                    banner: member.user.banner,
                    username: member.user.username,
                    displayName: member.user.displayName
                });
                
                
            });
            console.log(`📥 Loaded ${guild.members.cache.size} members from ${guild.name}`);
        } catch (error) {
            console.error(`Error loading members from ${guild.name}:`, error);
        }
    }

    // Verificação ULTRA RÁPIDA - a cada 1 segundo
    setInterval(async () => {
        const memberIds = Array.from(allGuildMembers);
        
        // Verificar em batches de 10 usuários por vez para não sobrecarregar
        for (let i = 0; i < Math.min(10, memberIds.length); i++) {
            const userId = memberIds[i];
            await checkUserChanges(userId);
        }
        
        // Rotacionar a lista para verificar todos os usuários
        if (memberIds.length > 0) {
            const firstUser = memberIds.shift();
            memberIds.push(firstUser);
            allGuildMembers = new Set(memberIds);
        }
    }, 1000); // A cada 1 segundo!

    console.log(`🚀 Ultra-fast detection enabled! Checking every 1 second for ${allGuildMembers.size} users.`);
});

// Evento UserUpdate para detecção instantânea
client.on(Events.UserUpdate, async (oldUser, newUser) => {
    console.log(`⚡ UserUpdate event for ${newUser.tag}`);
    await checkUserChanges(newUser.id);
});

// Evento GuildMemberUpdate para mudanças de membro
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    console.log(`⚡ GuildMemberUpdate event for ${newMember.user.tag}`);
    await checkUserChanges(newMember.id);
});

// Quando novos membros entram
client.on(Events.GuildMemberAdd, (member) => {
    allGuildMembers.add(member.id);
    userCache.set(member.id, {
        avatar: member.user.avatar,
        banner: member.user.banner,
        username: member.user.username,
        displayName: member.user.displayName
    });
    console.log(`➕ New member added: ${member.user.tag}`);
});

// Quando membros saem
client.on(Events.GuildMemberRemove, (member) => {
    allGuildMembers.delete(member.id);
    userCache.delete(member.id);
    console.log(`➖ Member removed: ${member.user.tag}`);
});

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
    console.error('DISCORD_BOT_TOKEN not found in environment variables!');
    console.error('Please add your Discord bot token to the Secrets tab.');
    process.exit(1);
}

client.login(token);
