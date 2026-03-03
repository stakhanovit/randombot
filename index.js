const { Client, GatewayIntentBits, Events } = require('discord.js');
const Database = require('better-sqlite3');

// Inicia o banco de dados (ele cria o arquivo database.sqlite automaticamente)
const db = new Database('database.sqlite');

// Cria a tabela caso ela não exista
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT,
        display_name TEXT,
        avatar TEXT,
        banner TEXT
    )
`).run();

// Comandos de banco de dados preparados para velocidade
const getUserStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const insertUserStmt = db.prepare('INSERT INTO users (id, username, display_name, avatar, banner) VALUES (?, ?, ?, ?, ?)');
const updateUserStmt = db.prepare('UPDATE users SET username = ?, display_name = ?, avatar = ?, banner = ? WHERE id = ?');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildPresences // Necessário para o Discord enviar as atualizações de perfil em tempo real
    ]
});

const CHANNELS = {
    STATIC_AVATAR: '1445884129043415080',  
    GIF_AVATAR: '1445884170814361731',     
    BANNER_CHANGE: '1445884208970076321',
    USERNAME_CHANGE: '1478232755635617983',
    NICKNAME_CHANGE: '1478232755635617983'   
};

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

            if (changeType.includes('Banner') && newValue !== 'None') {
                embed.image = { url: newValue };
            } else if (changeType.includes('Avatar') && newValue !== 'None') {
                embed.image = { url: newValue };
            }

            await channel.send({ embeds: [embed] });
            console.log(`✅ ${changeType} notification sent for ${user.tag}`);
        }
    } catch (error) {
        console.error(`❌ Failed to send ${changeType} notification for ${user.tag}:`, error.message);
    }
}

async function sendTextNotification(channelId, user, type, oldText) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel && oldText) {
            const embed = {
                color: 0x9c41ff,
                description: `${type} disponível: \`${oldText}\``,
                footer: {
                    text: `GIFZADA - ${user.username}(${user.id})`,
                    icon_url: channel.guild.iconURL({ size: 128 })
                }
            };
            await channel.send({ embeds: [embed] });
            console.log(`✅ ${type} notification sent for ${user.tag}: ${oldText} is now available`);
        }
    } catch (error) {
        console.error(`❌ Failed to send ${type} notification for ${user.tag}:`, error.message);
    }
}

// A função principal que analisa o usuário e compara com o Banco de Dados
async function processUserChange(userId) {
    try {
        // Puxamos o usuário fresco da API para garantir que temos o Banner
        const fullUser = await client.users.fetch(userId, { force: true });

        // Buscamos o usuário no Banco de Dados
        const dbUser = getUserStmt.get(userId);

        const currentUsername = fullUser.username || null;
        const currentDisplayName = fullUser.globalName || fullUser.displayName || null; // globalName é o Display Name oficial no v14
        const currentAvatar = fullUser.avatar || null;
        const currentBanner = fullUser.banner || null;

        // Se o usuário não existe no DB, apenas salvamos ele para ter uma base de comparação futura.
        // Não enviamos notificação porque não sabemos se ele "mudou" ou se o bot só conheceu ele agora.
        if (!dbUser) {
            insertUserStmt.run(userId, currentUsername, currentDisplayName, currentAvatar, currentBanner);
            return;
        }

        let hasChanges = false;

        // 1. Checar Avatar
        if (dbUser.avatar !== currentAvatar) {
            hasChanges = true;
            if (currentAvatar) {
                const newAvatarUrl = fullUser.displayAvatarURL({ size: 512, extension: isGif(currentAvatar) ? 'gif' : 'png' });
                const type = isGif(currentAvatar) ? 'Avatar (GIF)' : 'Avatar (Static)';
                await sendNotification(isGif(currentAvatar) ? CHANNELS.GIF_AVATAR : CHANNELS.STATIC_AVATAR, fullUser, type, dbUser.avatar, newAvatarUrl);
            }
        }

        // 2. Checar Banner
        if (dbUser.banner !== currentBanner) {
            hasChanges = true;
            if (currentBanner) {
                const newBannerUrl = `https://cdn.discordapp.com/banners/${fullUser.id}/${currentBanner}${isGif(currentBanner) ? '.gif' : '.png'}?size=600`;
                const type = isGif(currentBanner) ? 'Banner (GIF)' : 'Banner (Static)';
                await sendNotification(CHANNELS.BANNER_CHANGE, fullUser, type, dbUser.banner, newBannerUrl);
            }
        }

        // 3. Checar Username
        if (dbUser.username !== currentUsername) {
            hasChanges = true;
            if (dbUser.username) {
                await sendTextNotification(CHANNELS.USERNAME_CHANGE, fullUser, 'username', dbUser.username);
            }
        }

        // 4. Checar Display Name
        if (dbUser.display_name !== currentDisplayName) {
            hasChanges = true;
            if (dbUser.display_name) {
                await sendTextNotification(CHANNELS.USERNAME_CHANGE, fullUser, 'display name', dbUser.display_name);
            }
        }

        // Se houve alguma mudança, atualiza o Banco de Dados
        if (hasChanges) {
            updateUserStmt.run(currentUsername, currentDisplayName, currentAvatar, currentBanner, userId);
        }

    } catch (error) {
        console.error(`Erro ao processar mudanças para o ID ${userId}:`, error.message);
    }
}

client.once(Events.ClientReady, () => {
    console.log(`🚀 Bot conectado como ${client.user.tag}!`);
    console.log(`💾 Sistema de Banco de Dados ativo. Aguardando atualizações dos usuários...`);
});

// Eventos que o Discord envia quando um usuário faz alterações no perfil global
client.on(Events.UserUpdate, async (oldUser, newUser) => {
    await processUserChange(newUser.id);
});

// Evento quando alguém entra no servidor: apenas guardamos no DB silenciosamente
client.on(Events.GuildMemberAdd, async (member) => {
    try {
        const dbUser = getUserStmt.get(member.id);
        if (!dbUser) {
            const user = await client.users.fetch(member.id, { force: true });
            insertUserStmt.run(user.id, user.username, user.globalName || user.displayName, user.avatar, user.banner);
        }
    } catch (err) {
        // Ignorar erros silenciosos de fetch
    }
});

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
    console.error('DISCORD_BOT_TOKEN não encontrado nas variáveis de ambiente!');
    process.exit(1);
}

client.login(token);
