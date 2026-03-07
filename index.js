const { 
    Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    MessageFlags, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
    ComponentType
} = require('discord.js');
const Database = require('better-sqlite3');

// Inicia o banco de dados
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

// Comandos de banco de dados preparados
const getUserStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const insertUserStmt = db.prepare('INSERT INTO users (id, username, display_name, avatar, banner) VALUES (?, ?, ?, ?, ?)');
const updateUserStmt = db.prepare('UPDATE users SET username = ?, display_name = ?, avatar = ?, banner = ? WHERE id = ?');

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
    NICKNAME_CHANGE: '1478232755635617983',
    REPORT_CHANNEL: '1479649622149435486' 
};

const ROLES = {
    MODERATOR: '1165308513355046973'
};

function isGif(url) {
    return url && (url.includes('.gif') || url.includes('a_'));
}

// Cria a ActionRow com o botão "Reportar"
const getReportActionRow = () => {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_report')
            .setLabel('Reportar')
            .setStyle(ButtonStyle.Danger)
    );
};

// ----------------------------------------------------
// SISTEMA DE NOTIFICAÇÕES USANDO COMPONENTS V2
// ----------------------------------------------------

async function sendNotification(channelId, user, changeType, oldValue, newValue) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
            // Define se é Avatar ou Banner para o texto ficar limpo
            const typeName = changeType.includes('Avatar') ? 'Avatar' : 'Banner';

            // 1. Cria o contêiner com o título simples: Avatar de `username`
            const container = new ContainerBuilder()
                .setAccentColor(0x9c41ff)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`${typeName} de \`${user.username}\``)
                );

            // 2. Adiciona a imagem usando MediaGallery
            if ((changeType.includes('Banner') || changeType.includes('Avatar')) && newValue !== 'None') {
                container.addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder().setURL(newValue)
                    )
                );
            }

            // 3. Adiciona o botão de Reportar
            container.addActionRowComponents(getReportActionRow());

            // 4. Envia
            await channel.send({ 
                flags: MessageFlags.IsComponentsV2,
                components: [container] 
            });
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
            // Remove o rodapé GIFZADA daqui também para manter o visual minimalista
            const container = new ContainerBuilder()
                .setAccentColor(0x9c41ff)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`${type} disponível: \`${oldText}\``)
                )
                .addActionRowComponents(getReportActionRow());

            await channel.send({ 
                flags: MessageFlags.IsComponentsV2,
                components: [container] 
            });
            console.log(`✅ ${type} notification sent for ${user.tag}`);
        }
    } catch (error) {
        console.error(`❌ Failed to send ${type} notification for ${user.tag}:`, error.message);
    }
}

// ----------------------------------------------------
// PROCESSAMENTO DE USUÁRIOS
// ----------------------------------------------------

async function processUserChange(userId) {
    try {
        const fullUser = await client.users.fetch(userId, { force: true });
        const dbUser = getUserStmt.get(userId);

        const currentUsername = fullUser.username || null;
        const currentDisplayName = fullUser.globalName || fullUser.displayName || null;
        const currentAvatar = fullUser.avatar || null;
        const currentBanner = fullUser.banner || null;

        if (!dbUser) {
            insertUserStmt.run(userId, currentUsername, currentDisplayName, currentAvatar, currentBanner);
            return;
        }

        let hasChanges = false;

        if (dbUser.avatar !== currentAvatar) {
            hasChanges = true;
            if (currentAvatar) {
                const newAvatarUrl = fullUser.displayAvatarURL({ size: 512, extension: isGif(currentAvatar) ? 'gif' : 'png' });
                const type = isGif(currentAvatar) ? 'Avatar (GIF)' : 'Avatar (Static)';
                await sendNotification(isGif(currentAvatar) ? CHANNELS.GIF_AVATAR : CHANNELS.STATIC_AVATAR, fullUser, type, dbUser.avatar, newAvatarUrl);
            }
        }

        if (dbUser.banner !== currentBanner) {
            hasChanges = true;
            if (currentBanner) {
                const newBannerUrl = `https://cdn.discordapp.com/banners/${fullUser.id}/${currentBanner}${isGif(currentBanner) ? '.gif' : '.png'}?size=600`;
                const type = isGif(currentBanner) ? 'Banner (GIF)' : 'Banner (Static)';
                await sendNotification(CHANNELS.BANNER_CHANGE, fullUser, type, dbUser.banner, newBannerUrl);
            }
        }

        if (dbUser.username !== currentUsername) {
            hasChanges = true;
            if (dbUser.username) {
                await sendTextNotification(CHANNELS.USERNAME_CHANGE, fullUser, 'Username', dbUser.username);
            }
        }

        if (dbUser.display_name !== currentDisplayName) {
            hasChanges = true;
            if (dbUser.display_name) {
                await sendTextNotification(CHANNELS.USERNAME_CHANGE, fullUser, 'Display name', dbUser.display_name);
            }
        }

        if (hasChanges) {
            updateUserStmt.run(currentUsername, currentDisplayName, currentAvatar, currentBanner, userId);
        }

    } catch (error) {
        console.error(`Erro ao processar mudanças para o ID ${userId}:`, error.message);
    }
}

// ----------------------------------------------------
// INTERAÇÕES E BOTÕES (DENÚNCIAS)
// ----------------------------------------------------

client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId === 'btn_report') {
        const reportChannel = client.channels.cache.get(CHANNELS.REPORT_CHANNEL);
        if (!reportChannel) {
            return interaction.reply({ content: '❌ Canal de denúncias não encontrado!', ephemeral: true });
        }

        const reportedMessage = interaction.message;
        let contentReported = 'Conteúdo desconhecido';

        try {
            if (reportedMessage.flags.has(MessageFlags.IsComponentsV2)) {
                const containerData = reportedMessage.components[0]?.toJSON();
                if (containerData && containerData.components) {
                    for (const sub of containerData.components) {
                        if (sub.type === ComponentType.MediaGallery) {
                            contentReported = sub.items?.[0]?.media?.url || 'Imagem na galeria';
                        } else if (sub.type === ComponentType.TextDisplay && contentReported === 'Conteúdo desconhecido') {
                            contentReported = sub.content;
                        }
                    }
                }
            } else {
                contentReported = reportedMessage.embeds[0]?.image?.url || reportedMessage.embeds[0]?.description || 'Conteúdo antigo';
            }
        } catch (err) {
            console.error('Erro ao ler V2 para o reporte:', err);
        }

        const reportEmbed = {
            color: 0xff0000,
            title: '🚨 Nova Denúncia Registrada',
            description: `**Denunciante:** ${interaction.user} (${interaction.user.id})\n**Canal:** <#${interaction.channel.id}>\n**Mensagem Original:** [Acessar a mensagem](${reportedMessage.url})`,
            fields: [
                {
                    name: 'Conteúdo denunciado',
                    value: contentReported.length > 1024 ? contentReported.substring(0, 1021) + '...' : contentReported
                }
            ],
            timestamp: new Date().toISOString()
        };

        const modActionRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`del_${interaction.channel.id}_${reportedMessage.id}`)
                .setLabel('Apagar conteúdo')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(`keep_${interaction.channel.id}_${reportedMessage.id}`)
                .setLabel('Manter conteúdo')
                .setStyle(ButtonStyle.Secondary)
        );

        await reportChannel.send({
            content: `<@&${ROLES.MODERATOR}>`, 
            embeds: [reportEmbed],
            components: [modActionRow]
        });

        return interaction.reply({ content: '✅ Sua denúncia foi enviada à moderação!', ephemeral: true });
    }

    if (interaction.customId.startsWith('del_') || interaction.customId.startsWith('keep_')) {
        if (!interaction.member.roles.cache.has(ROLES.MODERATOR)) {
            return interaction.reply({ content: '❌ Você não tem o cargo necessário para moderar denúncias.', ephemeral: true });
        }

        const [action, targetChannelId, targetMessageId] = interaction.customId.split('_');

        if (action === 'del') {
            try {
                const targetChannel = await client.channels.fetch(targetChannelId);
                const targetMessage = await targetChannel.messages.fetch(targetMessageId);
                await targetMessage.delete();

                await interaction.update({ 
                    content: ` O conteúdo foi **apagado** por ${interaction.user}.`, 
                    components: [] 
                });
            } catch (error) {
                await interaction.update({ 
                    content: `⚠️ A mensagem já foi apagada ou não existe mais. (Ação por ${interaction.user})`, 
                    components: [] 
                });
            }
        } else if (action === 'keep') {
            await interaction.update({ 
                content: ` O moderador ${interaction.user} decidiu **manter** o conteúdo.`, 
                components: [] 
            });
        }
    }
});

client.once(Events.ClientReady, () => {
    console.log(`🚀 Bot conectado como ${client.user.tag}!`);
    console.log(`💾 Banco de Dados pronto. Notificações limpas (V2) ativadas.`);
});

client.on(Events.UserUpdate, async (oldUser, newUser) => {
    await processUserChange(newUser.id);
});

client.on(Events.GuildMemberAdd, async (member) => {
    try {
        const dbUser = getUserStmt.get(member.id);
        if (!dbUser) {
            const user = await client.users.fetch(member.id, { force: true });
            insertUserStmt.run(user.id, user.username, user.globalName || user.displayName, user.avatar, user.banner);
        }
    } catch (err) {}
});

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
    console.error('DISCORD_BOT_TOKEN não encontrado!');
    process.exit(1);
}

client.login(token);
