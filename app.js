/* app.js */
const express = require('express');
const request = require('request-promise');
const AWS = require('aws-sdk');
const Discord = require('discord.js');
const {promisify} = require('util');

const client = new Discord.Client();
const token = process.env.TOKEN;
const PORT = process.env.PORT || 3000;
const INSTANCE_ID = process.env.INSTANCE_ID;
const SERVER_URL = process.env.SERVER_URL;

const ec2 = new AWS.EC2(
    {
        apiVersion: '2016-11-15',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: 'ap-northeast-1'
    });

const ec2StartInstances = promisify(ec2.startInstances.bind(ec2));
const ec2StopInstances = promisify(ec2.stopInstances.bind(ec2));
const ec2DescribeInstanceStatus = promisify(ec2.describeInstanceStatus.bind(ec2));

const delayRun = (waitSeconds, someFunction) => {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(someFunction())
        }, waitSeconds)
    })
};

const runWithRetry = (maxRetry, interval, someFunction) => {
    return new Promise(async (resolve, reject) => {
        let curRetry = 0;
        for (let i = 0; i < maxRetry; i++) {
            if (await delayRun(interval, someFunction)) {
                resolve();
                break;
            }
        }

        reject();
    });
};

process.on("SIGTERM", () => {
    console.log("Got SIGTERM.");
    process.exit(128 + 15);
});

let mainChannel;

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
            .catch(console.error);
    }

    if (message.content === '/mc status') {
        message.reply('ステータスを確認しています。')
            .then(message => request({
                url: `https://mcapi.xdefcon.com/server/${SERVER_URL}/full/json`,
                method: 'get',
                json: true
            }))
            .then(body => {
                if (body.serverStatus === 'online') {
                    let loginNum = `${body.players}/${body.maxplayers}`;
                    // let list = body.players.list.map(s => '・' + s).join('\n');
                    return message.reply('現在オンラインです。\n' +
                        `ログイン：${loginNum}\n`
                    );
                } else {
                    return message.reply('現在オフラインです。');
                }
            })
            .catch(console.error);
    }

    if (message.content === '/mc start') {
        message.reply('サーバーを起動しています・・・')
            .then(message => ec2StartInstances({InstanceIds: [INSTANCE_ID]}))
            .then(data => runWithRetry(12, 10000, () => {
                console.log('retry');
                return request({
                    url: `https://mcapi.xdefcon.com/server/${SERVER_URL}/status/json`,
                    method: 'get',
                    json: true
                }).then(body => {
                    console.log(body);
                    return body.online
                });
            }))
            .then(() => message.reply('サーバーが起動しました。'))
            .catch(error => {
                message.reply('サーバーは起動していないかもしれません。');
                console.error(error);
            });
    }

    if (message.content === '/mc stop') {
        message.reply('サーバーを停止しています・・・。')
            .then(message => ec2StopInstances({InstanceIds: [INSTANCE_ID]}))
            .then(response => {
                runWithRetry(12, 10000, () => ec2DescribeInstanceStatus({InstanceIds: [INSTANCE_ID], IncludeAllInstances: true})
                    .then(response => response.InstanceStatuses[0].InstanceState.Name === 'stopped'))
            })
            .then(() => message.reply('サーバーを停止しました。'))
            .catch(error => {
                message.reply('サーバーの停止に失敗してしまいました。もう一回試してみてください。');
                console.error(error);
            });
    }
});

function tryShutdown() {
    request({
        url: `https://mcapi.xdefcon.com/server/${SERVER_URL}/full/json`,
        method: 'get',
        json: true
    })
        .then(body => {
            console.log(body);
            if (body.serverStatus === 'online' && body.players === 0) {
                mainChannel.send('誰もログインしていないので、サーバーを停止します。');
                return ec2StopInstances({InstanceIds: [INSTANCE_ID]});
            }

            return null;
        })
        .then(response => {
            console.log(response);
            if (response != null) {
                return runWithRetry(12, 10000, () => ec2DescribeInstanceStatus({InstanceIds: [INSTANCE_ID], IncludeAllInstances: true}))
                    .then(r => {
                        if (r !== undefined) {
                            console.log(r);
                            return r.InstanceStatuses[0].InstanceState.Name === 'stopped';
                        }

                        return false;
                    });
            }

            return null;
        })
        .then((data) => {
            if (data != null) {
                mainChannel.send('サーバーを停止しました。')
            }
        })
        .catch(error => {
            console.error(error);
            mainChannel.send('サーバーの停止に失敗してしまいました。もう一回試してみてください。');
        });
}

client.login(token)
    .catch(console.error);

// Heroku
express()
    .get('/', (req, res) => res.send({message: 'Healthy.'}))
    .get('/check', (req, res) => {
        tryShutdown();
        res.send({});
    })
    .get('/test', (req, res) => {
        ec2DescribeInstanceStatus({InstanceIds: [INSTANCE_ID], IncludeAllInstances: true})
            .then(r => {
                console.log(r.InstanceStatuses[0].InstanceState);
                res.send({});
            })
    })
    .listen(PORT, () => {
        console.log(`Listening on ${PORT}`);
        console.log(`INSTANCE_ID ${INSTANCE_ID}`);
    });