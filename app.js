/* app.js */
const Discord = require('discord.js');

const client = new Discord.Client();
const token = process.env.TOKEN;

process.on("SIGTERM", () => {
    console.log("Got SIGTERM.");
    process.exit(128 + 15);
});

client.on('ready', () => {
    console.log('ready...');
});

client.on('message', message => {
    if (message.author.bot) {
        return;
    }

    if (message.content === '/mc init') {
        mainChannel = message.channel;
        message.reply('初期化が完了しました')
            .then(message => console.log(`Sent message: ${replyText}`))
            .catch(console.error);
    }
});

client.login(token);
