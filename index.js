const { Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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
    NICKNAME_CHANGE: '1478232755635617983',
    REPORT_CHANNEL: '1479649622149435486' // Canal de denúncias
};

const ROLES = {
    MODERATOR: '1165308513355046973' // Cargo de moderação que pode aceitar/recusar denúncias
};

function isGif(url) {
    return url && (url.includes('.gif') || url.includes('a_'));
}

// Cria a fileira com o botão "Reportar" em vermelho
const getReportActionRow = () => {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_report')
            .setLabel('Reportar')
            .setStyle(ButtonStyle.Danger) // Botão Vermelho
    );
};

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

            // Envia a embed JUNTO com o componente do botão
            await channel.send({ embeds: [embed], components: [getReportActionRow()] });
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
            
            // Envia a embed JUNTO com o componente do botão
            await channel.send({ embeds: [embed], components: [getReportActionRow()] });
            console.log(`✅ ${type} notification sent for ${user.tag}: ${oldText} is now available`);
        }
    } catch (error) {
        console.error(`❌ Failed to send ${type} notification for ${user.tag}:`, error.message);
    }
}

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
                await sendTextNotification(CHANNELS.USERNAME_CHANGE, fullUser, 'username', dbUser.username);
            }
        }

        if (dbUser.display_name !== currentDisplayName) {
            hasChanges = true;
            if (dbUser.display_name) {
                await sendTextNotification(CHANNELS.USERNAME_CHANGE, fullUser, 'display name', dbUser.display_name);
            }
        }

        if (hasChanges) {
            updateUserStmt.run(currentUsername, currentDisplayName, currentAvatar, currentBanner, userId);
        }

    } catch (error) {
        console.error(`Erro ao processar mudanças para o ID ${userId}:`, error.message);
    }
}

// Gerenciador de Interações (Cliques em Botões)
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isButton()) return;

    // 1. Usuário clicou em REPORTAR
    if (interaction.customId === 'btn_report') {
        const reportChannel = client.channels.cache.get(CHANNELS.REPORT_CHANNEL);
        if (!reportChannel) {
            return interaction.reply({ content: '❌ Canal de denúncias não encontrado!', ephemeral: true });
        }

        const reportedMessage = interaction.message;
        const reportedEmbed = reportedMessage.embeds[0];
        
        // Pega a URL da imagem (se tiver) ou a descrição da embed
        const contentReported = reportedEmbed?.image?.url || reportedEmbed?.description || 'Conteúdo desconhecido';

        const reportEmbed = {
            color: 0xff0000,
            title: '🚨 Nova Denúncia Registrada',
            description: `**Denunciante:** ${interaction.user} (${interaction.user.id})\n**Canal:** <#${interaction.channel.id}>\n**Mensagem Original:** [Ir para a mensagem](${reportedMessage.url})`,
            fields: [
                {
                    name: 'Conteúdo denunciado',
                    value: typeof contentReported === 'string' ? contentReported : 'Imagem inclusa na embed'
                }
            ],
            timestamp: new Date().toISOString()
        };

        // Botões para a equipe de moderação avaliar
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

        // Envia a denúncia mencionando o cargo FORA da embed
        await reportChannel.send({
            content: `<@&${ROLES.MODERATOR}>`, 
            embeds: [reportEmbed],
            components: [modActionRow]
        });

        return interaction.reply({ content: '✅ A denúncia foi enviada com sucesso aos moderadores.', ephemeral: true });
    }

    // 2. Moderação clicou em APAGAR ou MANTER
    if (interaction.customId.startsWith('del_') || interaction.customId.startsWith('keep_')) {
        // Verifica se quem clicou tem o cargo exigido
        if (!interaction.member.roles.cache.has(ROLES.MODERATOR)) {
            return interaction.reply({ content: '❌ Apenas moderadores podem usar este botão.', ephemeral: true });
        }

        const args = interaction.customId.split('_');
        const action = args[0];
        const targetChannelId = args[1];
        const targetMessageId = args[2];

        if (action === 'del') {
            try {
                const targetChannel = await client.channels.fetch(targetChannelId);
                const targetMessage = await targetChannel.messages.fetch(targetMessageId);
                
                // Apaga a embed denunciada no canal público
                await targetMessage.delete();

                // Atualiza a embed de denúncia na moderação, removendo os botões
                await interaction.update({ 
                    content: `✅ O conteúdo foi **apagado** pelo moderador ${interaction.user}.`, 
                    components: [] 
                });
            } catch (error) {
                console.error('Erro ao apagar mensagem:', error);
                await interaction.update({ 
                    content: `⚠️ Não foi possível apagar a mensagem (pode já ter sido apagada). Ação registrada por ${interaction.user}.`, 
                    components: [] 
                });
            }
        }

        if (action === 'keep') {
            // Remove os botões e avisa que foi mantido
            await interaction.update({ 
                content: `🛡️ O conteúdo foi **mantido** pelo moderador ${interaction.user}. Nenhuma ação tomada.`, 
                components: [] 
            });
        }
    }
});

client.once(Events.ClientReady, () => {
    console.log(`🚀 Bot conectado como ${client.user.tag}!`);
    console.log(`💾 Sistema de Banco de Dados ativo. Aguardando atualizações...`);
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
