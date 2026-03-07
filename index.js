const { 
    Client, GatewayIntentBits, Events, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    MessageFlags, ContainerBuilder, TextDisplayBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder,
    ComponentType, Collection, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder
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

// Comandos de banco de dados
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

// --- SISTEMA DE COOLDOWN ---
const reportCooldowns = new Collection();
const COOLDOWN_AMOUNT = 60 * 1000; // 60 segundos de cooldown

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
// SISTEMA DE NOTIFICAÇÕES USANDO COMPONENTS V2
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
// INTERAÇÕES E BOTÕES (DENÚNCIAS E MODALS)
// ----------------------------------------------------

client.on(Events.InteractionCreate, async interaction => {

    // 1. QUANDO O USUÁRIO CLICA NO BOTÃO DE REPORTAR (ABRE O MODAL)
    if (interaction.isButton() && interaction.customId === 'btn_report') {
        const now = Date.now();
        if (reportCooldowns.has(interaction.user.id)) {
            const expirationTime = reportCooldowns.get(interaction.user.id) + COOLDOWN_AMOUNT;
            if (now < expirationTime) {
                const timeLeft = ((expirationTime - now) / 1000).toFixed(0);
                return interaction.reply({ 
                    content: `⏳ Você está em cooldown. Aguarde **${timeLeft} segundos** antes de reportar novamente.`, 
                    ephemeral: true 
                });
            }
        }
        
        // Registra o cooldown apenas na abertura do modal para evitar spam de pop-ups
        reportCooldowns.set(interaction.user.id, now);

        const reportedMessage = interaction.message;

        // Cria o Modal
        const modal = new ModalBuilder()
            // Passamos o ID do canal e da mensagem no customId do modal para usarmos no envio
            .setCustomId(`modal_submit_report_${interaction.channel.id}_${reportedMessage.id}`)
            .setTitle('Denunciar Imagem/GIF');

        // Cria o Menu de Seleção (Dropdown)
        const reasonSelect = new StringSelectMenuBuilder()
            .setCustomId('report_reason')
            .setPlaceholder('Escolha o motivo da denúncia...')
            .addOptions(
                { label: 'Conteúdo Explícito (NSFW)', value: 'NSFW - Conteúdo Explícito', description: 'Nudez ou pornografia' },
                { label: 'Gore / Violência Extrema', value: 'Gore - Violência Extrema', description: 'Imagens chocantes, sangue ou violência real' },
                { label: 'Assédio / Discurso de Ódio', value: 'Assédio - Discurso de Ódio', description: 'Racismo, homofobia ou ataques pessoais' },
                { label: 'Conteúdo Ilegal', value: 'Ilegal', description: 'Apologia a crimes, drogas, etc.' },
                { label: 'Outro Motivo', value: 'Outro', description: 'Não listado nas opções acima' }
            );

        // Cria a caixa de texto para mais detalhes (Que serve como AVISO)
        const detailsInput = new TextInputBuilder()
            .setCustomId('report_details')
            .setLabel('⚠️ FALSAS DENÚNCIAS RESULTAM EM BANIMENTO!')
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder('Tem algo a acrescentar? (Opcional). Esteja ciente de que o uso indevido deste botão resultará em punição severa.')
            .setRequired(false)
            .setMaxLength(300);

        // Adiciona as linhas de ação no modal (O Discord exige 1 componente por ActionRow em Modals)
        const firstActionRow = new ActionRowBuilder().addComponents(reasonSelect);
        const secondActionRow = new ActionRowBuilder().addComponents(detailsInput);

        modal.addComponents(firstActionRow, secondActionRow);

        // Mostra o Modal para o usuário
        await interaction.showModal(modal);
        return;
    }

    // 2. QUANDO O USUÁRIO ENVIA O MODAL (SUBMIT)
    if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('modal_submit_report_')) {
            const args = interaction.customId.split('_');
            const targetChannelId = args[3];
            const targetMessageId = args[4];

            const reportChannel = client.channels.cache.get(CHANNELS.REPORT_CHANNEL);
            if (!reportChannel) {
                return interaction.reply({ content: '❌ Canal de denúncias não configurado ou encontrado.', ephemeral: true });
            }

            // Resgata os valores que o usuário preencheu/selecionou
            let selectedReason = 'Não especificado';
            let extraDetails = 'Nenhum detalhe adicional';

            try {
                // Tenta puxar o array de valores do Select Menu do Modal
                const reasonField = interaction.fields.fields.get('report_reason');
                if (reasonField && reasonField.values && reasonField.values.length > 0) {
                    selectedReason = reasonField.values[0];
                }

                extraDetails = interaction.fields.getTextInputValue('report_details') || 'Nenhum detalhe adicional';
            } catch (err) {
                console.error("Erro ao ler campos do Modal:", err);
            }

            // Busca a mensagem original para extrair o link da imagem novamente
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
                return interaction.reply({ content: '⚠️ Não foi possível localizar a mensagem original. Ela pode já ter sido apagada.', ephemeral: true });
            }

            const reportEmbed = {
                color: 0xff0000,
                title: '🚨 Nova Denúncia Registrada',
                description: `**Denunciante:** ${interaction.user} (${interaction.user.id})\n**Canal:** <#${targetChannelId}>\n**Mensagem Original:** [Ir para a Mensagem](${reportedMessage.url})`,
                fields: [
                    {
                        name: 'Motivo da Denúncia',
                        value: selectedReason,
                        inline: true
                    },
                    {
                        name: 'Detalhes Adicionais',
                        value: extraDetails,
                        inline: true
                    },
                    {
                        name: 'Conteúdo Infrator',
                        value: contentReported.length > 1024 ? contentReported.substring(0, 1021) + '...' : contentReported,
                        inline: false
                    }
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

            return interaction.reply({ content: '✅ Sua denúncia foi enviada à equipe de moderação. Agradecemos sua ajuda!', ephemeral: true });
        }
    }

    // 3. QUANDO UM MODERADOR CLICA NOS BOTÕES DE APAGAR/MANTER
    if (interaction.isButton() && (interaction.customId.startsWith('del_') || interaction.customId.startsWith('keep_'))) {
        if (!interaction.member.roles.cache.has(ROLES.MODERATOR)) {
            return interaction.reply({ content: '❌ Acesso negado. Apenas moderadores.', ephemeral: true });
        }

        const [action, targetChannelId, targetMessageId] = interaction.customId.split('_');

        if (action === 'del') {
            try {
                const targetChannel = await client.channels.fetch(targetChannelId);
                const targetMessage = await targetChannel.messages.fetch(targetMessageId);
                await targetMessage.delete();

                await interaction.update({ 
                    content: `
                     O conteúdo foi **apagado** por ${interaction.user}.`, 
                    components: [] 
                });
            } catch (error) {
                await interaction.update({ 
                    content: ` A mensagem já não existe mais. (Ação por ${interaction.user})`, 
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
    console.log(`💾 Banco de Dados pronto. Sistema de Denúncias V2 (Modal) Ativado.`);
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
