const { 
    Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    MessageFlags, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
    ComponentType, Collection
} = require('discord.js');
const Database = require('better-sqlite3');

// ----------------------------------------------------
// INICIALIZAÇÃO DO BANCO DE DADOS
// ----------------------------------------------------
const db = new Database('database.sqlite');

db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT,
        display_name TEXT,
        avatar TEXT,
        banner TEXT
    )
`).run();

const getUserStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const insertUserStmt = db.prepare('INSERT INTO users (id, username, display_name, avatar, banner) VALUES (?, ?, ?, ?, ?)');
const updateUserStmt = db.prepare('UPDATE users SET username = ?, display_name = ?, avatar = ?, banner = ? WHERE id = ?');

// ----------------------------------------------------
// CONFIGURAÇÕES DO BOT
// ----------------------------------------------------
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

const reportCooldowns = new Collection();
const COOLDOWN_AMOUNT = 60 * 1000;

function isGif(url) {
    return url && (url.includes('.gif') || url.includes('a_'));
}

const getReportActionRow = () => {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('btn_report')
            .setLabel('Reportar')
            .setStyle(ButtonStyle.Danger)
    );
};

// ----------------------------------------------------
// HACK PARA CORRIGIR O CRASH DO DISCORD.JS COM O TYPE 18
// ----------------------------------------------------
client.on('raw', packet => {
    if (packet.t === 'INTERACTION_CREATE' && packet.d.type === 5) {
        const data = packet.d.data;
        if (data && data.components) {
            data.components.forEach(comp => {
                if (comp.type === 18 && comp.component && !comp.components) {
                    comp.components = [comp.component]; 
                }
            });
        }
    }
});

// ----------------------------------------------------
// SISTEMA DE NOTIFICAÇÕES (COMPONENTS V2)
// ----------------------------------------------------
async function sendNotification(channelId, user, changeType, oldValue, newValue) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel) {
            const typeName = changeType.includes('Avatar') ? 'Avatar' : 'Banner';

            const container = new ContainerBuilder()
                .setAccentColor(0x9c41ff)
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`${typeName} de \`${user.username}\``)
                );

            if ((changeType.includes('Banner') || changeType.includes('Avatar')) && newValue !== 'None') {
                container.addMediaGalleryComponents(
                    new MediaGalleryBuilder().addItems(
                        new MediaGalleryItemBuilder().setURL(newValue)
                    )
                );
            }

            container.addActionRowComponents(getReportActionRow());

            await channel.send({ 
                flags: MessageFlags.IsComponentsV2,
                components: [container] 
            });
            console.log(`✅ Notificação enviada: ${changeType} para ${user.tag}`);
        }
    } catch (error) {
        console.error(`❌ Erro ao enviar notificação de ${changeType} para ${user.tag}:`, error.message);
    }
}

async function sendTextNotification(channelId, user, type, oldText) {
    try {
        const channel = await client.channels.fetch(channelId);
        if (channel && oldText) {
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
            console.log(`✅ Notificação enviada: ${type} para ${user.tag}`);
        }
    } catch (error) {
        console.error(`❌ Erro ao enviar notificação de ${type} para ${user.tag}:`, error.message);
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
// INTERAÇÕES: MODALS, BOTÕES E DENÚNCIAS
// ----------------------------------------------------
client.on(Events.InteractionCreate, async interaction => {

    // 1. CLIQUE NO BOTÃO DE REPORTAR (ABRIR MODAL V2)
    if (interaction.isButton() && interaction.customId === 'btn_report') {
        const now = Date.now();
        if (reportCooldowns.has(interaction.user.id)) {
            const expirationTime = reportCooldowns.get(interaction.user.id) + COOLDOWN_AMOUNT;
            if (now < expirationTime) {
                const timeLeft = ((expirationTime - now) / 1000).toFixed(0);
                return interaction.reply({ 
                    content: `⏳ Você está em cooldown. Aguarde **${timeLeft} segundos** antes de reportar novamente.`, 
                    flags: MessageFlags.Ephemeral // Correção do Warning!
                });
            }
        }
        
        reportCooldowns.set(interaction.user.id, now);
        const reportedMessage = interaction.message;

        const rawModal = {
            title: 'Denunciar Imagem/GIF',
            custom_id: `modal_submit_report_${interaction.channel.id}_${reportedMessage.id}`,
            components: [
                {
                    type: 18, 
                    label: 'Qual o motivo da denúncia?',
                    component: {
                        type: 3, 
                        custom_id: 'report_reason',
                        placeholder: 'Escolha uma opção...',
                        options: [
                            { label: 'Conteúdo Explícito (NSFW)', value: 'NSFW', description: 'Nudez ou pornografia' },
                            { label: 'Gore / Violência Extrema', value: 'Gore', description: 'Sangue ou imagens chocantes' },
                            { label: 'Assédio / Discurso de Ódio', value: 'Assédio', description: 'Ofensas, racismo, etc.' },
                            { label: 'Conteúdo Ilegal', value: 'Ilegal', description: 'Drogas, apologia a crimes' },
                            { label: 'Outro Motivo', value: 'Outro', description: 'Não se enquadra nas anteriores' }
                        ]
                    }
                },
                {
                    type: 18, 
                    label: '⚠️ FALSAS DENÚNCIAS = BANIMENTO!',
                    description: 'Tem algo a acrescentar? (Opcional)',
                    component: {
                        type: 4, 
                        custom_id: 'report_details',
                        style: 2, 
                        max_length: 300,
                        placeholder: 'Escreva detalhes adicionais. O uso indevido resultará em punição!',
                        required: false
                    }
                }
            ]
        };

        await interaction.showModal(rawModal);
        return;
    }

    // 2. ENVIO DO MODAL DE DENÚNCIA
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('modal_submit_report_')) {
            const args = interaction.customId.split('_');
            const targetChannelId = args[3];
            const targetMessageId = args[4];

            const reportChannel = client.channels.cache.get(CHANNELS.REPORT_CHANNEL);
            if (!reportChannel) {
                return interaction.reply({ 
                    content: '❌ Canal de denúncias não configurado.', 
                    flags: MessageFlags.Ephemeral // Correção do Warning!
                });
            }

            const reasonField = interaction.fields.fields.get('report_reason');
            const selectedReason = reasonField?.values ? reasonField.values[0] : 'Não especificado';

            const detailsField = interaction.fields.fields.get('report_details');
            const extraDetails = detailsField?.value || 'Nenhum detalhe adicional';

            let reportedMessage;
            let contentReported = 'Conteúdo desconhecido';
            
            try {
                const targetChannel = await client.channels.fetch(targetChannelId);
                reportedMessage = await targetChannel.messages.fetch(targetMessageId);

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
                console.error('Erro ao buscar a mensagem reportada:', err);
                return interaction.reply({ 
                    content: '⚠️ Não foi possível localizar a mensagem original. Ela pode já ter sido apagada.', 
                    flags: MessageFlags.Ephemeral 
                });
            }

            const reportEmbed = {
                color: 0xff0000,
                title: '🚨 Nova Denúncia Registrada',
                description: `**Denunciante:** ${interaction.user} (${interaction.user.id})\n**Canal:** <#${targetChannelId}>\n**Mensagem Original:** [Ir para a Mensagem](${reportedMessage.url})`,
                fields: [
                    { name: 'Motivo', value: selectedReason, inline: true },
                    { name: 'Detalhes Adicionais', value: extraDetails, inline: true },
                    { name: 'Conteúdo Infrator', value: contentReported.length > 1024 ? contentReported.substring(0, 1021) + '...' : contentReported, inline: false }
                ],
                timestamp: new Date().toISOString()
            };

            const modActionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`del_${targetChannelId}_${targetMessageId}`)
                    .setLabel('Apagar conteúdo')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`keep_${targetChannelId}_${targetMessageId}`)
                    .setLabel('Manter conteúdo')
                    .setStyle(ButtonStyle.Secondary)
            );

            await reportChannel.send({
                content: `<@&${ROLES.MODERATOR}>`, 
                embeds: [reportEmbed],
                components: [modActionRow]
            });

            return interaction.reply({ 
                content: '✅ Sua denúncia foi enviada à equipe de moderação. Agradecemos sua ajuda!', 
                flags: MessageFlags.Ephemeral 
            });
        }
    }

    // 3. DECISÃO DA MODERAÇÃO (APAGAR OU MANTER)
    if (interaction.isButton() && (interaction.customId.startsWith('del_') || interaction.customId.startsWith('keep_'))) {
        if (!interaction.member.roles.cache.has(ROLES.MODERATOR)) {
            return interaction.reply({ 
                content: '❌ Acesso negado. Apenas moderadores.', 
                flags: MessageFlags.Ephemeral 
            });
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
                    content: ` A mensagem já não existe mais no canal. (Ação registrada por ${interaction.user})`, 
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
    console.log(`💾 Banco de Dados pronto. Hack de Modals Type 18 ativado com sucesso!`);
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
    console.error('DISCORD_BOT_TOKEN não encontrado nas variáveis de ambiente!');
    process.exit(1);
}

client.login(token);
