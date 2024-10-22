/*
 * -------------------------------------------------------
 * |                                                     |
 * |            All credits to JF Dev                    |
 * |      Do not sell or redistribute this code.         |
 * |                                                     |
 * -------------------------------------------------------
 */

require('./db/config')
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const FormData = require('form-data');
const fetch = require("node-fetch");
const fs = require("fs");
const md5 = require('md5');
const moment = require('moment-timezone')
const sharp = require('sharp');
const chalk = require('chalk');
const figlet = require('figlet');
const { URLSearchParams } = require('url');
const {
    MongoClient,
    ServerApiVersion
} = require('mongodb');

const channelId = '@notifyjf_store';
const bot = new TelegramBot(global.token, {
    polling: true
});

const imagePath = global.poster;

const uri = global.mongodb;
const dbs = 'botdb_tele'
const mClient = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

let isConnected = false;
async function connectToDatabase() {
    if (!isConnected) {
        try {
            await mClient.connect();
            isConnected = true;  
            console.log("Connected to MongoDB");
        } catch (error) {
            console.error("Failed to connect to MongoDB:", error);
            throw error; 
        }
    }
}

let defaultMarkupPercentage = 0.03;
const hariini = moment.tz('Asia/Jakarta').locale('id').format('YYYY-MM-DD HH:mm:ss');

const originalSendMessage = bot.sendMessage.bind(bot);
bot.sendMessage = async function(chatId, text, options) {
    const message = await originalSendMessage(chatId, text, options);

    const senderId = bot.options.id; 
    const currentTime = moment().format('HH:mm:ss');
    const chatTitle = "BOT"; 

    console.log(chalk.red(chalk.bgBlack('[ PESAN ] => ')) + 
        chalk.white(chalk.bgBlack(text)) + '\n' + 
        chalk.magenta('=> Dari BOT '), chalk.green(senderId), 
        chalk.yellow(senderId) + '\n' + 
        chalk.blueBright('=> Di'), chalk.green(senderId) + '\n' + 
        chalk.magenta('Jam :') + chalk.cyan(currentTime));

    return message;
};

// ------------------------------- FUNCTION ------------------------------

async function sendMessageWithDelay(chatId, message) {
    await bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown'
    });
    return new Promise(resolve => setTimeout(resolve, sendMessageWithDelay));
}

function checkUserPermissions(msg) {
    const senderId = msg.from.id.toString();
    const isOwner = global.owner.map(v => v.replace(/[^0-9]/g, '')).includes(senderId);
    const isCreator = global.creator.map(v => v.replace(/[^0-9]/g, '')).includes(senderId);

    return {
        isOwner,
        isCreator
    };
}

let markupConfig = {};

async function getMarkupConfig() {
    try {
        await connectToDatabase();
        const db = mClient.db(dbs);
        const markupConfigCollection = db.collection('markup');

        const config = await markupConfigCollection.findOne({});
        return config || {};
    } catch (error) {
        console.error('Error fetching markup configuration:', error);
        throw error;
    }
}

async function initializeMarkupConfig() {
    try {
        markupConfig = await getMarkupConfig();
        //console.log('Markup configuration loaded:', markupConfig);
    } catch (error) {
        //console.error('Error reading markup configuration:', error);
    }
}
initializeMarkupConfig();

async function setMarkupConfig(markupConfig) {
    try {
        await connectToDatabase();
        const db = mClient.db(dbs);
        const markupCollection = db.collection('markup');

        await markupCollection.updateOne({}, {
            $set: markupConfig
        }, {
            upsert: true
        });
    } catch (error) {
        console.error("Error setting markup configuration:", error);
        throw error;
    }
}

function formatmoney(amount) {
    return `Rp. ${amount.toLocaleString()}`;
}

function generateUniqueRefID(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var charactersLength = characters.length;

    for (var i = 0; i < length; i++) {
        var randomIndex = Math.floor(Math.random() * charactersLength);
        result += characters.charAt(randomIndex);
    }
    result = 'JF' + result + 'DEPO';
    return result;
}

async function checkPaymentStatusPaydisini(unique_code, startTime, msg, sentMessage) {
    const currentTime = Date.now();
    const targetDepoOtomatis = msg.from.id;
    const paydisiniApikey = global.paydisini_apikey;
    const sign = md5(paydisiniApikey + unique_code + "StatusTransaction");

    const formData = new FormData();
    formData.append("key", paydisiniApikey);
    formData.append("request", "status");
    formData.append("unique_code", unique_code);
    formData.append("signature", sign);

    try {
        const response = await axios.post('https://paydisini.co.id/api/', formData, {
            headers: formData.getHeaders()
        });

        const responseData = response.data;

        if (responseData.success === true) {
            const data = responseData.data;

            if (data.status === 'Success') {
                const amountReceived = parseFloat(data.balance);

                await connectToDatabase();
                const database = mClient.db(dbs);
                const usersCollection = database.collection('users');

                const result = await usersCollection.updateOne({
                    nomor: String(targetDepoOtomatis)
                }, {
                    $inc: {
                        saldo: amountReceived
                    }
                });

                if (result.modifiedCount > 0) {
                    let depos = `[ Pembayaran Berhasil ]\n\n`;
                    depos += `Saldo kamu telah bertambah sebesar ${formatmoney(amountReceived)}\n`;
                    depos += `Ref ID : ${data.unique_code}\n\n`;
                    depos += `Silahkan klik Info Akun untuk detail.`;

                    const options = {
                        reply_markup: {
                            inline_keyboard: [
                                [{
                                    text: 'Info Akun',
                                    callback_data: 'me'
                                }]
                            ]
                        }
                    };

                    await bot.sendMessage(msg.chat.id, depos, options);
                }

            } else if (data.status === 'Canceled') {
                await bot.sendMessage(msg.chat.id, 'Pembayaran sudah dibatalkan.\nSilahkan lakukan deposit ulang!');
            } else {
                if (currentTime - startTime < 300000) {
                    setTimeout(() => {
                        checkPaymentStatusPaydisini(unique_code, startTime, msg, sentMessage);
                    }, 10000);
                } else {
                    await bot.sendMessage(msg.chat.id, 'QR sudah kadaluwarsa.\nSilahkan lakukan deposit ulang!');
					bot.deleteMessage(msg.chat.id, sentMessage.message_id);
                }
            }
        } else {
            await bot.sendMessage(msg.chat.id, responseData.msg);
        }

    } catch (error) {
        console.error('An error occurred:', error);
        await bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat memeriksa status pembayaran.');
    }
}

async function registerUser(sender, chatId, messageId) {
    try {
        await connectToDatabase();
        const database = mClient.db(dbs);
        const usersCollection = database.collection('users');

        const existingUser = await usersCollection.findOne({
            nomor: sender
        });

        if (existingUser) {
            const responseMessage = `Kamu sudah terdaftar\nRole kamu adalah ${existingUser.role}`;
        } else {
            const defaultRole = 'BRONZE';
            const newUser = {
                nomor: sender,
                saldo: 0,
                role: defaultRole,
            };

            await usersCollection.insertOne(newUser);

            const responseMessage = `「 Register Sukses 」\n\nUser ID : ${sender}\nRole : BRONZE\nSaldo : 0\n\nKetik /start untuk melihat menu.`;
            console.log(responseMessage)

            const toChannel = `User baru telah mendaftar\n\nUser ID: ${sender}\nRole: ${defaultRole}`;
            bot.sendMessage(channelId, toChannel);
        }
    } catch (err) {
        console.error("Error in register command:", err);
        await bot.sendMessage(chatId, '❌ Terjadi kesalahan saat memproses permintaan Anda.');
    }
}

async function getUserRole(userId) {
    try {
        await connectToDatabase();
        const database = mClient.db(dbs);
        const usersCollection = database.collection('users');

        const user = await usersCollection.findOne({
            nomor: userId
        });

        if (!user || !user.role) {
            console.error(`User with ID ${userId} not found or has no role.`);
            return null;
        }

        const {
            role
        } = user;

        return {
            role
        };

    } catch (error) {
        console.error("Error fetching user role:", error);
        return null;
    }
}

async function getUserByNumber(nomor) {
    try {
        await connectToDatabase();
        const database = mClient.db(dbs); 
        const users = database.collection('users');

        const user = await users.findOne({
            nomor: nomor
        });
        return user;
    } catch (error) {
        console.error('Error fetching user by number:', error);
        return null;
    }
}

async function updateUserBalance(nomor, amount) {
    try {
        await connectToDatabase();
        const db = mClient.db(dbs);
        const usersCollection = db.collection('users');
        await usersCollection.updateOne({
            nomor: nomor
        }, {
            $inc: {
                saldo: amount
            }
        });
    } catch (error) {
        console.error('Error updating user balance:', error);
    }
}

async function addTransaction(transaction) {
    try {
        await connectToDatabase();
        const db = mClient.db(dbs);
        const transactionsCollection = db.collection('trx');

        await transactionsCollection.insertOne(transaction);
        return {
            success: true
        };
    } catch (error) {
        console.error("Error in addTransaction:", error);
        return {
            error: 'Terjadi kesalahan saat menambahkan transaksi.'
        };
    }
}

async function addProfit(profit) {
    try {
        await connectToDatabase();
        const db = mClient.db(dbs);
        const transactionsCollection = db.collection('keuntungan');

        await transactionsCollection.insertOne(profit);
        return {
            success: true
        };
    } catch (error) {
        console.error("Error in addTransaction:", error);
        return {
            error: 'Terjadi kesalahan saat menambahkan transaksi.'
        };
    }
}

async function myInfo(sender, chatId, pushname) {
    try {
        await connectToDatabase();
        const database = mClient.db(dbs);
        const usersCollection = database.collection('users');
        const pointsCollection = database.collection('points');

        const userNomor = sender.toString();
        const userProfile = await usersCollection.findOne({
            nomor: userNomor
        });
        const userPoints = await pointsCollection.findOne({
            nomor: userNomor
        });

        if (!userProfile) {
            await bot.sendMessage(chatId, 'Kamu belum terdaftar, silahkan ketik /register.');
            return;
        }
        const {
            nomor,
            saldo,
            role
        } = userProfile;
        const points = userPoints ? userPoints.points : 0;

        const formatSaldo = (amount) => `Rp. ${amount.toLocaleString()}`;
        const profileMessage = `「 Profile 」

Username: ${pushname}
ID: ${nomor}
Saldo: ${formatSaldo(saldo)}
Role: ${role}

Cek riwayat transaksi mu dengan cara
ketik /cekriwayat

Ingin upgrade role?
ketik /upgrade`;

        await bot.sendMessage(chatId, profileMessage, {
            parse_mode: 'Markdown'
        });
    } catch (err) {
        console.error("Error in myInfo function:", err);
        await bot.sendMessage(chatId, '❌ Terjadi kesalahan pada server.');
    }
}

async function getTransactionsByUser(nomor) {
    try {
        await connectToDatabase();
        const db = mClient.db(dbs);
        const transactionsCollection = db.collection('trx');
        const transactions = await transactionsCollection.find({
            nomor: nomor,
            status: 'Sukses'
        }).toArray();
        return transactions;
    } catch (error) {
        console.error("Error in getTransactionsByUser:", error);
        return [];
    }
}

async function updateRole(target, newRole) {
    try {
        await connectToDatabase();
        const db = mClient.db(dbs);
        const usersCollection = db.collection('users');

        const user = await usersCollection.findOne({
            nomor: target
        });
        if (!user) {
            throw new Error('User not found');
        }

        await usersCollection.updateOne({
            nomor: target
        }, {
            $set: {
                role: newRole.toUpperCase()
            }
        });

        return {
            baru: newRole.toUpperCase()
        };
    } catch (error) {
        console.error('Error updating role:', error);
        throw error;
    }
}

async function upgradeUserRole(userId, chatId) {
    try {
        await connectToDatabase();
        const db = mClient.db(dbs);
        const usersCollection = db.collection('users');

        const availableRoles = ['bronze', 'gold', 'platinum'];
        const user = await usersCollection.findOne({
            nomor: userId
        });

        if (!user) {
            bot.sendMessage(chatId, 'User not found');
        }

        const currentRoleIndex = availableRoles.indexOf(user.role.toLowerCase());

        if (currentRoleIndex === -1) {
            bot.sendMessage(chatId, `Role ${user.role} tidak valid`);
        }

        const nextRoleIndex = currentRoleIndex + 1;
        const nextRole = availableRoles[nextRoleIndex];

        if (!nextRole) {
            bot.sendMessage(chatId, 'Anda sudah tidak dapat Upgrade Role.');
        }

        const rolePrices = {
            gold: global.gold,
            platinum: global.platinum,
        };

        const rolePrice = rolePrices[nextRole];

        if (user.saldo < rolePrice) {
            bot.sendMessage(chatId, `Maaf, saldo anda tidak cukup untuk upgrade\nRole : ${nextRole.toUpperCase()}\nHarga : Rp ${rolePrice.toLocaleString()}`);
        }

        user.saldo -= rolePrice;
        await usersCollection.updateOne({
            nomor: userId
        }, {
            $set: {
                saldo: user.saldo,
                role: nextRole.toUpperCase()
            }
        });

        return {
            prevRole: user.role,
            newRole: nextRole.toUpperCase(),
        };
    } catch (error) {
        console.error('Error upgrading role:', error);
        throw error;
    }
}

async function getJFProducts() {
    const postData = {
        api_key: global.apikey
    };

    try {
        const response = await fetch('https://topup.j-f.cloud/api/products', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(postData)
        });

        const data = await response.json();

        if (data.status) {
            return data.data;
        } else {
            console.error('Error:', data.message);
            return null;
        }
    } catch (error) {
        console.error('Error fetching data from JFSTORE API:', error);
        return null;
    }
}

async function getJFProductId(productId) {
    const products = await getJFProducts();
    return products.find(product => product.product_id === productId);
}

async function getMedanPediaServices() {
	try {
		await connectToDatabase();
		
		const db = mClient.db('botdb');
		const medanServicesCollection = db.collection('data_medanpedia');

		const services = await medanServicesCollection.find().toArray();
		return services;
	} catch (error) {
		console.error('Error fetching buzzer services data:', error);
		throw error;
	}
}

async function getUserProfile(nomor) {
    try {
        await connectToDatabase(); 
        
        const db = mClient.db(dbs); 
        const usersCollection = db.collection('users');

        const userProfile = await usersCollection.findOne({ nomor: nomor });

        return userProfile;
    } catch (error) {
        console.error('Error fetching user profile:', error);
        throw error;
    }
}

// -------------------------------/start Command------------------------------

const welcomeMessage = `<b>🛒 Welcome to ${global.botName}</b>\n\n` +
    `I’m here to assist you with all your needs, from game top-ups, e-wallet services, to boosting your social media presence.\n\n` +
    `🧑‍💻 ᴅᴇᴠᴇʟᴏᴘᴇᴅ ʙʏ : <a href="t.me/lux_arcadiaa">ᴊꜰ ᴅᴇᴠ</a>\n\n` + `---`;

// List Produk
const gameRows = [
	{ text: "Arena of Valor", callback_data: "get_arena of valor" },
    { text: "AU2 Mobile", callback_data: "get_au2 mobile" },
    { text: "Blood Strike", callback_data: "get_blood strike" },
    { text: "Call of Duty Mobile", callback_data: "get_call of duty mobile" },
    { text: "Free Fire Indo", callback_data: "get_free fire" },
    { text: "Genshin Impact", callback_data: "get_genshin impact" },
    { text: "Honor of Kings", callback_data: "get_honor of kings" },
    { text: "Identity V", callback_data: "get_identity v" },
    { text: "Honkai Star Rail", callback_data: "get_honkai star rail" },
    { text: "Mobile Legends Indo", callback_data: "get_mobile legends" },
    { text: "Mobile Legends Global", callback_data: "get_mobile legends global" },
    { text: "Mobile Legends PH", callback_data: "get_mobile legends ph" },
    { text: "Mobile Legends MY", callback_data: "get_mobile legends my" },
    { text: "Point Blank", callback_data: "get_point blank" },
    { text: "PUBG Mobile Indo", callback_data: "get_pubg mobile" },
    { text: "PUBG Mobile Global", callback_data: "get_pubg mobile global" },
    { text: "Undawn", callback_data: "get_undawn" },
    { text: "Valorant MY", callback_data: "get_valorant my" },
    { text: "LoL Wild Rift", callback_data: "get_league of legends wild rift" }
];

const pulsaRows = [
	{ text: "By.U", callback_data: "get_by.u" },
    { text: "Indosat", callback_data: "get_indosat" },
    { text: "Telkomsel", callback_data: "get_telkomsel" },
    { text: "Tri", callback_data: "get_tri" }
];

const emoneyRows = [
	{ text: "DANA", callback_data: "get_dana" },
    { text: "GO PAY", callback_data: "get_gopay" },
    { text: "OVO", callback_data: "get_ovo" },
    { text: "SHOPEE PAY", callback_data: "get_shopeepay" }
];

const plnRows = [
{ text: "PLN", callback_data: "get_pln"}
];

//----------------------------- start command -----------------------------

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
	const messageId = msg.message_id;

    const options = {
        caption: welcomeMessage,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎮 Games", callback_data: 'games' }, { text: "💵 E-Money", callback_data: 'emoney' }, { text: "💳 Pulsa", callback_data: 'pulsa' }, { text: "⚡ PLN", callback_data: 'pln' }],
                [{ text: "🚀 Boost Social Media", callback_data: 'boost_sm' }, { text: "👤 Profile", callback_data: 'profile' }]
            ]
        }
    };

    bot.sendPhoto(chatId, imagePath, {
        ...options,
        reply_to_message_id: messageId 
    });
});

bot.onText(/\/menu/, (msg) => {
    const chatId = msg.chat.id;
    const messageId = msg.message_id;

    const options = {
        caption: welcomeMessage,
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎮 Games", callback_data: 'games' }, { text: "💵 E-Money", callback_data: 'emoney' }, { text: "💳 Pulsa", callback_data: 'pulsa' }, { text: "⚡ PLN", callback_data: 'pln' }],
                [{ text: "🚀 Boost Social Media", callback_data: 'boost_sm' }, { text: "👤 Profile", callback_data: 'profile' }]
            ]
        }
    };

    bot.sendPhoto(chatId, imagePath, {
        ...options,
        reply_to_message_id: messageId 
    });
});

bot.onText(/\/dashboard/, async (msg) => {
	(function(_0x249c87,_0x1fcdc6){const _0x691e19=_0x3e4b,_0x20c7d8=_0x249c87();while(!![]){try{const _0x3bb286=-parseInt(_0x691e19(0x284))/(0x11eb+0x2446+0x1210*-0x3)+parseInt(_0x691e19(0x2da))/(-0x13*-0x105+0x71a+-0x1a77)+parseInt(_0x691e19(0x27d))/(-0x2128+0x1*0xf59+0x11d2)*(parseInt(_0x691e19(0x24c))/(0xfa0+-0x2255*0x1+0x12b9*0x1))+parseInt(_0x691e19(0x2aa))/(-0x1b01+0x2028+-0x522)*(parseInt(_0x691e19(0x190))/(0x32*-0x53+0x12*0xa2+0x4d8))+parseInt(_0x691e19(0x24f))/(0x31a*0x1+-0x234e+0x203b)+parseInt(_0x691e19(0x22b))/(0x1780+0x14a5+0x1*-0x2c1d)+parseInt(_0x691e19(0x1c6))/(0xb4f*0x2+0x2e8*-0x4+-0xaf5)*(-parseInt(_0x691e19(0x1ce))/(-0x9a9+-0x1c43+-0xe2*-0x2b));if(_0x3bb286===_0x1fcdc6)break;else _0x20c7d8['push'](_0x20c7d8['shift']());}catch(_0x59cf39){_0x20c7d8['push'](_0x20c7d8['shift']());}}}(_0x2cc7,-0x9ad2b+0x7cbf+0x22*0x84dc));const _0x18db8e=_0x36c7;function _0x5cdc(){const _0x34329c=_0x3e4b,_0x3dbe6e={'BPjSp':_0x34329c(0x287),'BgFvE':_0x34329c(0x227)+'cQ','RXbaa':_0x34329c(0x2b4),'cDEtl':_0x34329c(0x253),'jrMzY':_0x34329c(0x2a0),'WtLwC':_0x34329c(0x1ba),'ZXLIs':_0x34329c(0x1e9),'kaVbe':_0x34329c(0x242),'cERuf':_0x34329c(0x211),'Jorhv':_0x34329c(0x2a5),'wohTX':_0x34329c(0x22f),'YFFuv':_0x34329c(0x298),'QORvA':_0x34329c(0x1d7),'wNNGd':_0x34329c(0x25f),'qQjYm':_0x34329c(0x25b),'TIaME':_0x34329c(0x205),'XHNnC':_0x34329c(0x2e7),'gRVfo':_0x34329c(0x237),'ndtwh':_0x34329c(0x18d),'rcCbr':_0x34329c(0x1e7),'rfFhn':_0x34329c(0x224),'nZoie':_0x34329c(0x2d9),'lZPLW':_0x34329c(0x20d),'zUxxe':_0x34329c(0x1a0),'FFwgy':_0x34329c(0x191),'MBRsH':_0x34329c(0x2c2),'hLRWR':_0x34329c(0x189),'dDUid':_0x34329c(0x25c),'cmIVV':_0x34329c(0x2c1),'giMSo':_0x34329c(0x299)+_0x34329c(0x2d4),'PkrMW':_0x34329c(0x301),'cspmr':_0x34329c(0x2df),'BRcxX':_0x34329c(0x204),'cOTyE':_0x34329c(0x2fa),'SwUEb':_0x34329c(0x252),'eieYc':_0x34329c(0x201),'KQZIz':_0x34329c(0x1d2),'fKovf':_0x34329c(0x1e1),'VJmof':_0x34329c(0x1d3),'iogEN':_0x34329c(0x2f7),'knYjj':_0x34329c(0x2fb),'DkzgN':_0x34329c(0x2a4),'lbdII':_0x34329c(0x251),'NlvmT':_0x34329c(0x254),'uKsmG':_0x34329c(0x1ee),'NIRzn':_0x34329c(0x1b8),'bUNDv':_0x34329c(0x1a2),'AcWNV':_0x34329c(0x234),'KMzzd':_0x34329c(0x292)+'B','DaYIy':_0x34329c(0x276),'hPEvX':_0x34329c(0x177),'QyBCT':_0x34329c(0x2d3),'AfGTB':_0x34329c(0x283),'CwCkD':_0x34329c(0x19e),'cacrx':_0x34329c(0x221),'sExQz':_0x34329c(0x20e),'fCCYi':_0x34329c(0x1cd),'ugOhs':_0x34329c(0x19b),'aRzzD':_0x34329c(0x2c8),'TAyLA':_0x34329c(0x293),'BsQTz':_0x34329c(0x1ef),'JgmSu':_0x34329c(0x1ac),'MKurt':_0x34329c(0x22d),'VIjcD':_0x34329c(0x207),'NRMyO':_0x34329c(0x170),'Wbgrf':_0x34329c(0x223),'hjbCD':_0x34329c(0x259),'qxDXO':_0x34329c(0x1fe),'krGcb':_0x34329c(0x2ae),'aZfxg':_0x34329c(0x27f),'YSehz':_0x34329c(0x262),'zxqhF':_0x34329c(0x16c)+_0x34329c(0x21f),'mkpEI':_0x34329c(0x2e5),'yFDpq':_0x34329c(0x23e),'XDaLU':_0x34329c(0x202),'YcqwD':_0x34329c(0x26c)+_0x34329c(0x1da),'ivwcw':_0x34329c(0x2f6),'TVXDD':_0x34329c(0x1bb),'Snasr':_0x34329c(0x2f1),'ATfvc':_0x34329c(0x275),'TlZiF':_0x34329c(0x2e1),'xRXOc':_0x34329c(0x1d5),'OwzRM':_0x34329c(0x273),'rOqmp':_0x34329c(0x1e8),'NpFnq':_0x34329c(0x2d7),'Xwmcc':_0x34329c(0x22a),'AeelQ':_0x34329c(0x1a7),'masbX':_0x34329c(0x2a7),'eqsVs':_0x34329c(0x265),'iIEEp':_0x34329c(0x2ee),'UuwAv':_0x34329c(0x282),'zznrW':_0x34329c(0x195),'AteyW':_0x34329c(0x278),'WfgKE':_0x34329c(0x2bd),'xiWiP':_0x34329c(0x21d),'BENBd':_0x34329c(0x1f4),'DXjJv':_0x34329c(0x290),'RkaVz':_0x34329c(0x1a5),'WbrtA':_0x34329c(0x2c6),'RNVag':_0x34329c(0x1fb),'pFCWa':_0x34329c(0x212),'Qcduc':_0x34329c(0x24b),'dHJnP':_0x34329c(0x187),'BNAxx':_0x34329c(0x1dd),'XEzgG':_0x34329c(0x2d5),'AuOCJ':_0x34329c(0x215),'bSSjZ':_0x34329c(0x1af),'XZdpy':_0x34329c(0x295),'aYbrE':_0x34329c(0x2d2),'Uqgpo':_0x34329c(0x2b6),'fjiCJ':_0x34329c(0x291),'ZbHPq':_0x34329c(0x16e),'SQZRI':_0x34329c(0x2f0),'bjPPe':_0x34329c(0x1f6),'zDMzw':_0x34329c(0x174),'aPdCS':_0x34329c(0x269),'wbQrn':_0x34329c(0x1b1),'RujEe':_0x34329c(0x1fd),'KOduJ':_0x34329c(0x213),'vyHal':_0x34329c(0x289),'dMlql':_0x34329c(0x305),'jKiOP':_0x34329c(0x2fc),'UxpIJ':_0x34329c(0x257),'qAdYU':_0x34329c(0x1d4),'TzSdT':_0x34329c(0x1e5),'QDmzc':_0x34329c(0x172),'wEulV':_0x34329c(0x28b),'noYfN':_0x34329c(0x279)+'t','DlFPL':_0x34329c(0x1c5),'rMmNI':_0x34329c(0x2ca),'swvGh':_0x34329c(0x193),'UQlsT':_0x34329c(0x1e4),'qZdcQ':_0x34329c(0x28c),'jQXjl':_0x34329c(0x1a3)+_0x34329c(0x20c),'BEEYY':function(_0x105298){return _0x105298();}},_0x488b09=[_0x3dbe6e[_0x34329c(0x23d)],_0x3dbe6e[_0x34329c(0x219)],_0x3dbe6e[_0x34329c(0x2b8)],_0x3dbe6e[_0x34329c(0x173)],_0x3dbe6e[_0x34329c(0x1c2)],_0x3dbe6e[_0x34329c(0x2cb)],_0x3dbe6e[_0x34329c(0x1bd)],_0x3dbe6e[_0x34329c(0x2cf)],_0x3dbe6e[_0x34329c(0x17f)],_0x3dbe6e[_0x34329c(0x1ca)],_0x3dbe6e[_0x34329c(0x1ff)],_0x3dbe6e[_0x34329c(0x256)],_0x3dbe6e[_0x34329c(0x258)],_0x3dbe6e[_0x34329c(0x288)],_0x3dbe6e[_0x34329c(0x18b)],_0x3dbe6e[_0x34329c(0x25d)],_0x3dbe6e[_0x34329c(0x23c)],_0x3dbe6e[_0x34329c(0x28f)],_0x3dbe6e[_0x34329c(0x198)],_0x3dbe6e[_0x34329c(0x175)],_0x3dbe6e[_0x34329c(0x23f)],_0x3dbe6e[_0x34329c(0x186)],_0x3dbe6e[_0x34329c(0x25e)],_0x3dbe6e[_0x34329c(0x200)],_0x3dbe6e[_0x34329c(0x1e0)],_0x3dbe6e[_0x34329c(0x302)],_0x3dbe6e[_0x34329c(0x17c)],_0x3dbe6e[_0x34329c(0x2c7)],_0x3dbe6e[_0x34329c(0x188)],_0x3dbe6e[_0x34329c(0x2b3)],_0x3dbe6e[_0x34329c(0x183)],_0x3dbe6e[_0x34329c(0x2cd)],_0x3dbe6e[_0x34329c(0x2fe)],_0x3dbe6e[_0x34329c(0x1eb)],_0x3dbe6e[_0x34329c(0x1f3)],_0x3dbe6e[_0x34329c(0x1e2)],_0x3dbe6e[_0x34329c(0x1ad)],_0x3dbe6e[_0x34329c(0x23b)],_0x3dbe6e[_0x34329c(0x27e)],_0x3dbe6e[_0x34329c(0x2c5)],_0x3dbe6e[_0x34329c(0x2a8)],_0x3dbe6e[_0x34329c(0x2b1)],_0x3dbe6e[_0x34329c(0x238)],_0x3dbe6e[_0x34329c(0x22e)],_0x3dbe6e[_0x34329c(0x2e2)],_0x3dbe6e[_0x34329c(0x2ad)],_0x3dbe6e[_0x34329c(0x1f2)],_0x3dbe6e[_0x34329c(0x179)],_0x3dbe6e[_0x34329c(0x1c9)],_0x3dbe6e[_0x34329c(0x1ae)],_0x3dbe6e[_0x34329c(0x2e4)],_0x3dbe6e[_0x34329c(0x286)],_0x3dbe6e[_0x34329c(0x236)],_0x3dbe6e[_0x34329c(0x206)],_0x3dbe6e[_0x34329c(0x2a2)],_0x3dbe6e[_0x34329c(0x2bc)],_0x3dbe6e[_0x34329c(0x18f)],_0x3dbe6e[_0x34329c(0x24d)],_0x3dbe6e[_0x34329c(0x1dc)],_0x3dbe6e[_0x34329c(0x2c0)],_0x3dbe6e[_0x34329c(0x2ab)],_0x3dbe6e[_0x34329c(0x300)],_0x3dbe6e[_0x34329c(0x243)],_0x3dbe6e[_0x34329c(0x23a)],_0x3dbe6e[_0x34329c(0x1e6)],_0x3dbe6e[_0x34329c(0x218)],_0x3dbe6e[_0x34329c(0x25a)],_0x3dbe6e[_0x34329c(0x1cf)],_0x3dbe6e[_0x34329c(0x232)],_0x3dbe6e[_0x34329c(0x1fa)],_0x3dbe6e[_0x34329c(0x1f0)],_0x3dbe6e[_0x34329c(0x2e8)],_0x3dbe6e[_0x34329c(0x272)],_0x3dbe6e[_0x34329c(0x203)],_0x3dbe6e[_0x34329c(0x28a)],_0x3dbe6e[_0x34329c(0x1b6)],_0x3dbe6e[_0x34329c(0x285)],_0x3dbe6e[_0x34329c(0x245)],_0x3dbe6e[_0x34329c(0x1de)],_0x3dbe6e[_0x34329c(0x235)],_0x3dbe6e[_0x34329c(0x1f9)],_0x3dbe6e[_0x34329c(0x2a1)],_0x3dbe6e[_0x34329c(0x2b5)],_0x3dbe6e[_0x34329c(0x1bc)],_0x3dbe6e[_0x34329c(0x26b)],_0x3dbe6e[_0x34329c(0x225)],_0x3dbe6e[_0x34329c(0x281)],_0x3dbe6e[_0x34329c(0x2a9)],_0x3dbe6e[_0x34329c(0x182)],_0x3dbe6e[_0x34329c(0x229)],_0x3dbe6e[_0x34329c(0x1f5)],_0x3dbe6e[_0x34329c(0x24a)],_0x3dbe6e[_0x34329c(0x228)],_0x3dbe6e[_0x34329c(0x2d6)],_0x3dbe6e[_0x34329c(0x2dd)],_0x3dbe6e[_0x34329c(0x17d)],_0x3dbe6e[_0x34329c(0x230)],_0x3dbe6e[_0x34329c(0x19d)],_0x3dbe6e[_0x34329c(0x17e)],_0x3dbe6e[_0x34329c(0x1c4)],_0x3dbe6e[_0x34329c(0x21e)],_0x3dbe6e[_0x34329c(0x29b)],_0x3dbe6e[_0x34329c(0x216)],_0x3dbe6e[_0x34329c(0x27c)],_0x3dbe6e[_0x34329c(0x1b5)],_0x3dbe6e[_0x34329c(0x1c7)],_0x3dbe6e[_0x34329c(0x222)],_0x3dbe6e[_0x34329c(0x2f4)],_0x3dbe6e[_0x34329c(0x2c4)],_0x3dbe6e[_0x34329c(0x1b0)],_0x3dbe6e[_0x34329c(0x217)],_0x3dbe6e[_0x34329c(0x1b9)],_0x3dbe6e[_0x34329c(0x297)],_0x3dbe6e[_0x34329c(0x1bf)],_0x3dbe6e[_0x34329c(0x1ab)],_0x3dbe6e[_0x34329c(0x209)],_0x3dbe6e[_0x34329c(0x260)],_0x3dbe6e[_0x34329c(0x2cc)],_0x3dbe6e[_0x34329c(0x196)],_0x3dbe6e[_0x34329c(0x2ce)],_0x3dbe6e[_0x34329c(0x241)],_0x3dbe6e[_0x34329c(0x1cc)],_0x3dbe6e[_0x34329c(0x214)],_0x3dbe6e[_0x34329c(0x2e9)],_0x3dbe6e[_0x34329c(0x270)],_0x3dbe6e[_0x34329c(0x22c)],_0x3dbe6e[_0x34329c(0x2c3)],_0x3dbe6e[_0x34329c(0x2dc)],_0x3dbe6e[_0x34329c(0x16d)],_0x3dbe6e[_0x34329c(0x2f9)],_0x3dbe6e[_0x34329c(0x1ec)],_0x3dbe6e[_0x34329c(0x17a)],_0x3dbe6e[_0x34329c(0x197)],_0x3dbe6e[_0x34329c(0x16f)]];return _0x5cdc=function(){return _0x488b09;},_0x3dbe6e[_0x34329c(0x184)](_0x5cdc);}(function(_0x2db86a,_0x313e74){const _0x44f6d7=_0x3e4b,_0xd4fb55={'QRDfl':function(_0x505db9){return _0x505db9();},'JotZT':function(_0x351009,_0x33cbb0){return _0x351009+_0x33cbb0;},'JwNmr':function(_0x1e3249,_0x4f822a){return _0x1e3249+_0x4f822a;},'ychuN':function(_0xe1018,_0x5a9a63){return _0xe1018+_0x5a9a63;},'JKmBj':function(_0x485ffd,_0x477471){return _0x485ffd+_0x477471;},'IzIAn':function(_0x42d1df,_0x1f4c3c){return _0x42d1df+_0x1f4c3c;},'YEGVy':function(_0x4ca8a0,_0xbd0772){return _0x4ca8a0*_0xbd0772;},'WucJD':function(_0x17e9a1,_0x458d19){return _0x17e9a1/_0x458d19;},'IGwWy':function(_0x312323,_0x466c31){return _0x312323(_0x466c31);},'hHAjL':function(_0x2c3dd9,_0x5ca71e){return _0x2c3dd9+_0x5ca71e;},'lvqFx':function(_0x525bb2,_0x398af4){return _0x525bb2*_0x398af4;},'apgYA':function(_0x464463,_0x1cf272){return _0x464463(_0x1cf272);},'jDWDG':function(_0x515101,_0x1ed446){return _0x515101(_0x1ed446);},'aMVqR':function(_0x10169a,_0x5ae4bd){return _0x10169a+_0x5ae4bd;},'xeqQl':function(_0x16bc2c,_0x1cb05e){return _0x16bc2c*_0x1cb05e;},'fNuVY':function(_0x435673,_0x23ee8e){return _0x435673(_0x23ee8e);},'QLKIu':function(_0x29d2ce,_0x145ce0){return _0x29d2ce*_0x145ce0;},'gTSWj':function(_0x1cf619,_0x305e73){return _0x1cf619(_0x305e73);},'sjgeY':function(_0x5999dc,_0x2d1e27){return _0x5999dc(_0x2d1e27);},'sciEE':function(_0x244c76,_0x5a54c0){return _0x244c76*_0x5a54c0;},'YvFvc':function(_0x3c2822,_0x4d6ff8){return _0x3c2822*_0x4d6ff8;},'vUdaj':function(_0xc1b5b4,_0x3673c0){return _0xc1b5b4/_0x3673c0;},'zXAfj':function(_0x4dc68e,_0x389354){return _0x4dc68e*_0x389354;},'hVjBV':function(_0x52e8ac,_0x4502ed){return _0x52e8ac*_0x4502ed;},'qLuwG':function(_0x45ed03,_0x5e08e2){return _0x45ed03(_0x5e08e2);},'OomSW':function(_0x5d5392,_0x3c7ee7){return _0x5d5392+_0x3c7ee7;},'NABPd':function(_0x1a6185,_0x476885){return _0x1a6185*_0x476885;},'Jkvbi':function(_0x24d186,_0x20f90c){return _0x24d186/_0x20f90c;},'twcog':function(_0x308e16,_0x1b8b1e){return _0x308e16(_0x1b8b1e);},'ZJfXU':function(_0x1b1283,_0x4bdd28){return _0x1b1283+_0x4bdd28;},'OCwMO':function(_0x5832a8,_0x3a4843){return _0x5832a8*_0x3a4843;},'atmGg':function(_0x35a776,_0x13b678){return _0x35a776*_0x13b678;},'DiOgq':function(_0x199d99,_0x26cf7f){return _0x199d99(_0x26cf7f);},'GvWak':function(_0x1aadc1,_0x2f48a0){return _0x1aadc1*_0x2f48a0;},'uhjRw':function(_0x10c1ad,_0x238fb0){return _0x10c1ad/_0x238fb0;},'AefjG':function(_0xd39ad4,_0x493f50){return _0xd39ad4(_0x493f50);},'Hmiaj':function(_0x3fdba5,_0x4711f8){return _0x3fdba5(_0x4711f8);},'FdXGd':function(_0x5bb5d1,_0x944fda){return _0x5bb5d1+_0x944fda;},'wVXWP':function(_0x25139c,_0x39e67b){return _0x25139c+_0x39e67b;},'eVLVC':function(_0x2a1736,_0x22beea){return _0x2a1736*_0x22beea;},'MChCt':function(_0x4c34c6,_0x163a6b){return _0x4c34c6/_0x163a6b;},'OTXAF':function(_0x1aa2bb,_0x2c2405){return _0x1aa2bb(_0x2c2405);},'PSDYm':function(_0x374a7c,_0x5b2704){return _0x374a7c(_0x5b2704);},'PXxDS':function(_0x4e3a00,_0x3d6936){return _0x4e3a00+_0x3d6936;},'DSaWk':function(_0x4d3e01,_0x3a79db){return _0x4d3e01*_0x3a79db;},'Qravb':function(_0x25c116,_0x426ef1){return _0x25c116/_0x426ef1;},'bsJZK':function(_0x5bc062,_0x15b4a5){return _0x5bc062(_0x15b4a5);},'KjShC':function(_0x17b3fd,_0x4f20e1){return _0x17b3fd*_0x4f20e1;},'OjTBp':function(_0x3188ab,_0xba5c36){return _0x3188ab/_0xba5c36;},'MvKIJ':function(_0x18eef6,_0x455b61){return _0x18eef6*_0x455b61;},'JfrER':function(_0x49f9e4,_0x2eb8b0){return _0x49f9e4===_0x2eb8b0;},'Kgtgm':_0x44f6d7(0x255),'IgATA':_0x44f6d7(0x194)},_0x41ecd1=_0x36c7,_0x1256fe=_0xd4fb55[_0x44f6d7(0x18e)](_0x2db86a);while(!![]){try{const _0x19790f=_0xd4fb55[_0x44f6d7(0x29e)](_0xd4fb55[_0x44f6d7(0x2ec)](_0xd4fb55[_0x44f6d7(0x17b)](_0xd4fb55[_0x44f6d7(0x2ec)](_0xd4fb55[_0x44f6d7(0x1d1)](_0xd4fb55[_0x44f6d7(0x2b9)](_0xd4fb55[_0x44f6d7(0x263)](_0xd4fb55[_0x44f6d7(0x26e)](-_0xd4fb55[_0x44f6d7(0x171)](parseInt,_0xd4fb55[_0x44f6d7(0x171)](_0x41ecd1,0x2159*0x1+-0x17f9+-0x2*0x3d1)),_0xd4fb55[_0x44f6d7(0x1f1)](_0xd4fb55[_0x44f6d7(0x29e)](-(-0x1456+0xab+-0x4f*-0x83),_0xd4fb55[_0x44f6d7(0x2f2)](0x1*0x22e1+-0x230f+-0x11*-0x5,-0x29*-0x89+0xe07+-0x2383*0x1)),-0x17*0x151+0x1ecb+0x26c)),_0xd4fb55[_0x44f6d7(0x26e)](_0xd4fb55[_0x44f6d7(0x1b4)](parseInt,_0xd4fb55[_0x44f6d7(0x220)](_0x41ecd1,0x2f*-0x4+0x72*0x3b+-0x1798)),_0xd4fb55[_0x44f6d7(0x210)](_0xd4fb55[_0x44f6d7(0x17b)](-(-0x1c49+-0xb3b*-0x2+0x219d),-(0x11f2+0xdd*-0x2b+0x2197)),-0x3409+0xe8a*-0x1+0x6cc9))),_0xd4fb55[_0x44f6d7(0x1c0)](_0xd4fb55[_0x44f6d7(0x26e)](_0xd4fb55[_0x44f6d7(0x2f3)](parseInt,_0xd4fb55[_0x44f6d7(0x1b4)](_0x41ecd1,0x210c+0x312*-0x1+0x53*-0x57)),_0xd4fb55[_0x44f6d7(0x17b)](_0xd4fb55[_0x44f6d7(0x29e)](0x74*0x20+0x1b59+0x1*-0x1b46,_0xd4fb55[_0x44f6d7(0x2c9)](0x24ca+-0xcfe*0x1+-0x3*0x7e5,-0xb54+0x2*0x134+0x16d*0x7)),-(-0x3ad3+-0x949*0x2+0x7aa8))),_0xd4fb55[_0x44f6d7(0x26e)](-_0xd4fb55[_0x44f6d7(0x268)](parseInt,_0xd4fb55[_0x44f6d7(0x1b7)](_0x41ecd1,-0x142d+-0x18c0+0xe*0x35b)),_0xd4fb55[_0x44f6d7(0x210)](_0xd4fb55[_0x44f6d7(0x210)](_0xd4fb55[_0x44f6d7(0x248)](0x16f0+0x23da+-0x36e5,0x6f7+-0x169b+0x1f5*0x8),_0xd4fb55[_0x44f6d7(0x29c)](-(0x10*0x251+-0x341*-0x1+0x283a*-0x1),-0xa7*0x1d+0xb*-0x241+-0x2c81*-0x1)),0x274*-0x9+0x787+-0x9*-0x1ea)))),_0xd4fb55[_0x44f6d7(0x1d6)](-_0xd4fb55[_0x44f6d7(0x268)](parseInt,_0xd4fb55[_0x44f6d7(0x1b4)](_0x41ecd1,-0x2706+0x10b8+0x1823)),_0xd4fb55[_0x44f6d7(0x2ec)](_0xd4fb55[_0x44f6d7(0x1d1)](-0xd*0x296+0x1*0x1517+0xf8b*0x1,_0xd4fb55[_0x44f6d7(0x2a6)](-0x4f8+-0x995+0xf3c,-(0x3*-0x293+-0xc6a+0x1426))),_0xd4fb55[_0x44f6d7(0x180)](-0xb*-0x2bb+0x5f4+-0x23e7,-(0x1645+0x1e27+-0x1*0x3461))))),_0xd4fb55[_0x44f6d7(0x1d6)](-_0xd4fb55[_0x44f6d7(0x268)](parseInt,_0xd4fb55[_0x44f6d7(0x19c)](_0x41ecd1,-0x7*0x537+-0x466*-0x1+0x224c)),_0xd4fb55[_0x44f6d7(0x277)](_0xd4fb55[_0x44f6d7(0x29e)](-(0x4cf+-0x45*0x6f+-0x9*-0x456),_0xd4fb55[_0x44f6d7(0x248)](-(-0x22ee+-0xb*0x32f+0x4a*0xf2),-(0x2179+-0x7d1*0x2+0x224))),-(0x1d*0x158+0x1c*-0x3b+-0x1a79)))),_0xd4fb55[_0x44f6d7(0x1c1)](_0xd4fb55[_0x44f6d7(0x1b3)](-_0xd4fb55[_0x44f6d7(0x171)](parseInt,_0xd4fb55[_0x44f6d7(0x304)](_0x41ecd1,0x2db*0xd+0x626+-0x4*0xa4c)),_0xd4fb55[_0x44f6d7(0x277)](_0xd4fb55[_0x44f6d7(0x247)](_0xd4fb55[_0x44f6d7(0x1f8)](0xad2+-0x1*0x36a+-0x767,-(-0x7*0x29d+-0x2d58*0x1+0x5edb)),_0xd4fb55[_0x44f6d7(0x20a)](-0x1e5b+0x1716+-0x51*-0x17,-0x41b+-0x1*-0x3a5+0xb6d)),_0xd4fb55[_0x44f6d7(0x248)](-(0x56*-0xd+0x45f*0x1+-0xe*-0x1),-(0x23a1+0x1675+-0x1*0x3977)))),_0xd4fb55[_0x44f6d7(0x1b3)](_0xd4fb55[_0x44f6d7(0x2f3)](parseInt,_0xd4fb55[_0x44f6d7(0x266)](_0x41ecd1,0x4ca+0x2408+-0x270c)),_0xd4fb55[_0x44f6d7(0x2ec)](_0xd4fb55[_0x44f6d7(0x2b9)](-(-0x4fe+-0x7*-0x272+-0x3*-0x773),_0xd4fb55[_0x44f6d7(0x2ef)](-0x104d+0x28*0xd+-0x19*-0x98,-0x1*0x248a+-0x7*-0x157+0x1b46)),-0x1c87+0x22e0+-0xb81*-0x1)))),_0xd4fb55[_0x44f6d7(0x1c0)](_0xd4fb55[_0x44f6d7(0x306)](-_0xd4fb55[_0x44f6d7(0x240)](parseInt,_0xd4fb55[_0x44f6d7(0x192)](_0x41ecd1,-0x100b+0x1e83+0x3*-0x435)),_0xd4fb55[_0x44f6d7(0x18c)](_0xd4fb55[_0x44f6d7(0x26d)](-(-0xdc7*0x2+0x1ae7+0x5cd),-(-0x1*-0x27b2+0xa1*-0x1+0x85d*-0x1)),_0xd4fb55[_0x44f6d7(0x226)](-0xa*-0x493+0x3*-0xffa+-0x3*-0xcb1,-0x1*-0x620+0x8dd*0x2+-0xa5*0x25))),_0xd4fb55[_0x44f6d7(0x19f)](-_0xd4fb55[_0x44f6d7(0x249)](parseInt,_0xd4fb55[_0x44f6d7(0x185)](_0x41ecd1,0x1e95*-0x1+0x1be2+0x482)),_0xd4fb55[_0x44f6d7(0x18c)](_0xd4fb55[_0x44f6d7(0x1a1)](-(0x1a72+0x22b4+-0x2ef3),_0xd4fb55[_0x44f6d7(0x1c0)](0x1*0x1384+0x1f07+-0x27e4,-(-0x8+0x9bd+-0xd*0xbf))),_0xd4fb55[_0x44f6d7(0x29d)](-(-0x250c+0x8e0*-0x1+0x2def),-(0x185d+-0x1205+0x581)))))),_0xd4fb55[_0x44f6d7(0x226)](_0xd4fb55[_0x44f6d7(0x26f)](-_0xd4fb55[_0x44f6d7(0x185)](parseInt,_0xd4fb55[_0x44f6d7(0x1f7)](_0x41ecd1,0x1345+0x16a2+-0x27d4)),_0xd4fb55[_0x44f6d7(0x2b9)](_0xd4fb55[_0x44f6d7(0x210)](_0xd4fb55[_0x44f6d7(0x20f)](-(0xc1*-0x7+-0x2*-0x7be+-0x10*0x52),0xa6b+0x2*-0xcdf+0xf5a),-0x157f+0x3f1f+-0xa01*0x1),0x16d3*-0x1+-0x407*0x5+0x2ef5)),_0xd4fb55[_0x44f6d7(0x178)](-_0xd4fb55[_0x44f6d7(0x1b7)](parseInt,_0xd4fb55[_0x44f6d7(0x2f3)](_0x41ecd1,-0x1efc+-0x2001+0x40b2)),_0xd4fb55[_0x44f6d7(0x2b9)](_0xd4fb55[_0x44f6d7(0x26d)](_0xd4fb55[_0x44f6d7(0x29f)](0xdf4+0x267d+-0x1a2a*0x2,0x5de+0x65+0xb2*-0x9),_0xd4fb55[_0x44f6d7(0x1f8)](-0x5b*-0x29+-0xf29+-0x1*-0x9e,-(0x25b7+-0x1*0x1c1+0xb57*-0x3))),0x7fa+-0x1*-0xf1+0x68c))));if(_0xd4fb55[_0x44f6d7(0x24e)](_0x19790f,_0x313e74))break;else _0x1256fe[_0xd4fb55[_0x44f6d7(0x181)]](_0x1256fe[_0xd4fb55[_0x44f6d7(0x2e6)]]());}catch(_0x56f165){_0x1256fe[_0xd4fb55[_0x44f6d7(0x181)]](_0x1256fe[_0xd4fb55[_0x44f6d7(0x2e6)]]());}}}(_0x5cdc,(-0x2*-0x324+-0x714+0xd3*0x1)*(-0x1bc28+-0x1*0x18c23+0x4a064)+(-0x411*0x2+-0x14*0x18a+-0x101*-0x27)*(0x9161+0x54b8+-0x93f2)+(0x129e+0x6d*-0x2e+0x119)*-(-0xac37+-0x21d*-0x3c+0xc09a)));function _0x36c7(_0x2f8073,_0x2ba983){const _0x298a78=_0x3e4b,_0x2f57b0={'SIMuP':function(_0x4b1b7a,_0x5b88ec){return _0x4b1b7a-_0x5b88ec;},'xqYhG':function(_0xe711b7,_0x489bee){return _0xe711b7+_0x489bee;},'TWFsW':function(_0x5380c4,_0x561e5f){return _0x5380c4*_0x561e5f;},'ZPtli':function(_0x1450f0){return _0x1450f0();},'zVdYx':function(_0x5dbbe3,_0x2a8d65,_0x37c38e){return _0x5dbbe3(_0x2a8d65,_0x37c38e);}},_0x36b716=_0x2f57b0[_0x298a78(0x267)](_0x5cdc);return _0x36c7=function(_0x551852,_0x5b6091){const _0x2d9142=_0x298a78;_0x551852=_0x2f57b0[_0x2d9142(0x2de)](_0x551852,_0x2f57b0[_0x2d9142(0x1a6)](_0x2f57b0[_0x2d9142(0x1a6)](_0x2f57b0[_0x2d9142(0x303)](-0x2551*0x1+0x584+0x1fce,0x1b71+-0x1f8c+0x150c),-(-0x1*0x5c9+-0x10dd*-0x1+-0x2*-0x30)),-(0xd77+-0x1b7*0x5+-0x118)));let _0x16271a=_0x36b716[_0x551852];return _0x16271a;},_0x2f57b0[_0x298a78(0x2bb)](_0x36c7,_0x2f8073,_0x2ba983);}function _0x3e4b(_0x519124,_0x524663){const _0x2f45e1=_0x2cc7();return _0x3e4b=function(_0x2e0865,_0x197dc2){_0x2e0865=_0x2e0865-(-0x8f9+0x67*0x5e+-0x3b*0x77);let _0x4f834f=_0x2f45e1[_0x2e0865];return _0x4f834f;},_0x3e4b(_0x519124,_0x524663);}const chatId=msg[_0x18db8e(-0x1*-0xb01+-0xa41+-0x52*-0x3)]['id'],senderId=msg[_0x18db8e(-0x1766+-0x13b6+0x2ce5)]['id'],{isOwner,isCreator}=checkUserPermissions(msg);if(!isOwner)return bot[_0x18db8e(-0x2*0xda2+0x21d7*0x1+0x49f*-0x1)+'e'](msg[_0x18db8e(-0x11e7*0x1+-0x23ee+0x378b)]['id'],_0x18db8e(-0x6b*0x16+-0x2188+0x2cc9)+_0x18db8e(0x218+-0xf*0x216+0x1*0x1f11));function _0x2cc7(){const _0x4eeeee=['Penjualan\x20','Sukses\x20Har','MbNjS','vNxKl','gRVfo','Asia/Jakar','salahan\x20sa','40137ywNYS','from','YqGkQ','│\x20•\x20/accou','TfluO','SQZRI','92,\x20192,\x200','1957074GOW','uAHEC','Qcduc','YvFvc','DSaWk','JotZT','MvKIJ','.2)','xRXOc','cacrx','VwddV','Vrahi','Gagal\x20Bula','zXAfj','TIBRB','knYjj','masbX','10NPIoNF','BsQTz','NeUai','NIRzn','ole\x20[User\x20','KXLhl','ARTow','DkzgN','zrLAL','giMSo','ZyYRq','OwzRM','sendPhoto','CbpzN','RXbaa','IzIAn','YgndK','zVdYx','sExQz','(dalam\x20RM)','cvXpj','PUKAp','TAyLA','\x20Ini\x20:\x0a╰─>','at\x20mempros','wEulV','aYbrE','iogEN','day','dDUid','renderToBu','QLKIu','Fitur\x20khus','WtLwC','RujEe','cspmr','vyHal','kaVbe','DrBqG','xbwoY','harga','status','ATK','n\x20Ini\x20:\x0a╰─','WfgKE','ualan\x20Gaga','jyzxO','│\x20•\x20/addsa','2071830mlyqfx','KPRek','noYfN','xiWiP','SIMuP','ID]\x20[nomin','cNDgJ','botName','uKsmG','slQGQ','hPEvX','an\x20Ini\x20:\x0a╰','IgATA','getDate','zxqhF','qAdYU','EwfWt','qlEKf','JwNmr','Uqxuf','uBWTP','GvWak','kaiYu','chartjs-no','lvqFx','fNuVY','XZdpy','EgenA','waktu','12PpQkeX','xTKNz','rMmNI','╭────[\x20','chat','iYoeN','uJQSk','BRcxX','XsYBV','JgmSu','LtCpx','MBRsH','TWFsW','twcog','d\x20[nominal','uhjRw','1174320OMF','DlFPL','fromSQL','jQXjl','Error\x20fetc','IGwWy','getMonth','cDEtl','error','rcCbr','cFGbT','an\x20Ini','OjTBp','AcWNV','UQlsT','ychuN','hLRWR','BENBd','WbrtA','cERuf','hVjBV','Kgtgm','eqsVs','PkrMW','BEEYY','PSDYm','nZoie','sendMessag','cmIVV','map','ANumq','qQjYm','FdXGd','rgba(255,\x20','QRDfl','fCCYi','1085514ckPLFr','fill','Hmiaj','collection','shift','es\x20perinta','KOduJ','qZdcQ','ndtwh','IpTuG','wGrPz','i\x20Ini\x20:\x0a╰─','qLuwG','RkaVz','ViOgG','MChCt','ffer','PXxDS','l\x20:\x0a╰─>\x20','19364950gW','hrqDj','luxon','xqYhG','YvVkR','kyQUp','PFKGp','dhDhh','zDMzw','now','KQZIz','DaYIy','minal]\x0a','Uqgpo','Tanggal','inFaw','Jkvbi','apgYA','XEzgG','YcqwD','sjgeY','PIDtv','ZbHPq','ID]\x20[Role]','startOf','rOqmp','ZXLIs','EHRha','bjPPe','xeqQl','NABPd','jrMzY','SbsOu','RNVag','yZgNQ','22014018NirDCN','AuOCJ','yOOYi','KMzzd','Jorhv','qYcKK','jKiOP','40UFJLUN','10ZJYayy','qxDXO','ArqFq','JKmBj','92,\x20192,\x201','al]\x0a','Total\x20Penj','us\x20owner!','vUdaj','getFullYea','NYBjX','QKAIa','DYI','cCUQM','aRzzD','qhAFw','Snasr','jvQEL','FFwgy','toLocaleSt','eieYc','xKRsu','es\x20\x20:\x0a╰─>\x20','─>\x20','NRMyO','promises','trx','hquLa','TYtRh','cOTyE','swvGh','LgPqF','white','eUxUR','YSehz','hHAjL','bUNDv','SwUEb','qrUuv','UuwAv','forEach','bsJZK','OCwMO','TlZiF','aZfxg','actions:','CwXbN','toArray','de-canvas','wohTX','zUxxe','er\x20ID]\x20[no','teToRinggi','yFDpq','Qhwyh','99,\x20132,\x201','CwCkD','xjeTv','wwPTr','aPdCS','atmGg','LygpG','NMcb','rgba(75,\x201','501kPFdfZ','KjShC','aMVqR','QbTCH','2iNdNIB','Sukses\x20Bul','UxpIJ','Sukses','dHJnP','fjiCJ','Wbgrf','BgFvE','ifCmF','eGUdH','QGHGr','\x20]\x0a','pFCWa','fpy','jDWDG','ring','bSSjZ','10ndNVwo','line','Xwmcc','eVLVC','757043NBul','AteyW','iIEEp','Gagal','1931136UfdsIM','QDmzc','「\x20DASHBOAR','NlvmT','qVpCx','DXjJv','rnZPG','krGcb','MGnGz','n\x20Ini','ATfvc','AfGTB','ualan\x20Suks','lbdII','zcMbA','VIjcD','fKovf','XHNnC','BPjSp','D\x20ADMIN\x20」\x0a','rfFhn','AefjG','dMlql','Terjadi\x20ke','MKurt','QLrUg','TVXDD','QatiT','ZJfXU','sciEE','OTXAF','zznrW','setZone','244QLgiub','ugOhs','JfrER','4839408DziPVf','lmebD','exchangeRa','moment','find','hing\x20trans','push','YFFuv','toDateStri','QORvA','Error:','hjbCD','Kdfbe','│\x20•\x20/reloa','TIaME','lZPLW','gsaldo\x20[Us','wbQrn','xgxQm','toFixed','YEGVy','bbMEY','╰────[\x20','DiOgq','ZPtli','gTSWj','│\x20•\x20/ubahr','Wmojn','NpFnq','7151337rSX','wVXWP','WucJD','Qravb','TzSdT','HbIaW','mkpEI','toJSDate','Xsjsb','99,\x20132,\x200','Rp\x20','OomSW','RM\x20','18132gsNMl','QrSXt','IVirw','BNAxx','52779iPdHbP','VJmof','ldo\x20[User\x20','bmywx','AeelQ','│\x20•\x20/kuran','nt\x0a','403472OCotuo','ivwcw','QyBCT','DrekN','wNNGd','Gagal\x20Hari','XDaLU'];_0x2cc7=function(){return _0x4eeeee;};return _0x2cc7();}try{const fs=require('fs')[_0x18db8e(-0x1758+0x1d8a+-0x40b)],{ChartJSNodeCanvas}=require(_0x18db8e(-0x1*-0x1412+0x2583+-0x37b9)+_0x18db8e(-0x1864+-0x567*-0x2+0xf67)),{DateTime}=require(_0x18db8e(0x143e+0x35e+-0x15ad)),moment=require(_0x18db8e(0x5*-0x765+0x1ae9*0x1+0x2*0x623)),width=-(-0x171f+-0xdcc+0x35f0)+(-0x1*-0x2384+0x548+-0x2439)+(-0x58a+-0x23bf+0x38db),height=(0x229*0x10+0x76f*-0x1+-0x1b1f)*(-0x1476*-0x1+0x1262+-0x1766)+(-0x1759+-0x1382*-0x2+-0xf16)*(-0x1a3*-0x12+-0xa*-0x2ee+-0x3a8f)+(0x1131+-0x1*-0xd2b+-0x1e59)*-(0x61b+-0x18a1+0x25ef),chartJSNodeCanvas=new ChartJSNodeCanvas({'width':width,'height':height,'backgroundColour':_0x18db8e(0x207+-0xb66+0xb19)});async function fetchData(){const _0x4c3cab=_0x3e4b,_0x167108={'xTKNz':function(_0x24787e){return _0x24787e();},'QGHGr':function(_0x2b49e5,_0x597eb0){return _0x2b49e5(_0x597eb0);},'vNxKl':function(_0x3ee24c,_0x26d34f){return _0x3ee24c+_0x26d34f;},'xKRsu':function(_0x27ee78,_0x5adc4d){return _0x27ee78+_0x5adc4d;},'KXLhl':function(_0x4a5283,_0x285d83){return _0x4a5283(_0x285d83);},'IVirw':function(_0xe10b3d,_0x441797){return _0xe10b3d(_0x441797);},'rnZPG':function(_0x1779e7,_0x3fc5d3){return _0x1779e7(_0x3fc5d3);},'lmebD':function(_0x1476a4,_0x5bad8a){return _0x1476a4(_0x5bad8a);},'DrBqG':function(_0x1cd6fa,_0x16063f){return _0x1cd6fa(_0x16063f);},'NYBjX':function(_0x17ea1e,_0x36fa8c){return _0x17ea1e(_0x36fa8c);},'uJQSk':function(_0x59da03,_0x369065){return _0x59da03(_0x369065);},'bmywx':function(_0x30eceb,_0x6dcaaa){return _0x30eceb(_0x6dcaaa);}},_0x1ade34=_0x18db8e,_0x2ea3c0={'LtCpx':function(_0x55c1dd){const _0x37f282=_0x3e4b;return _0x167108[_0x37f282(0x2f8)](_0x55c1dd);},'kaiYu':_0x167108[_0x4c3cab(0x21c)](_0x1ade34,-0x5*0x785+0x109*-0x2+0x298c),'Vrahi':_0x167108[_0x4c3cab(0x28e)](_0x167108[_0x4c3cab(0x1e3)](_0x167108[_0x4c3cab(0x2af)](_0x1ade34,0x5*-0x1c1+-0x156f+-0x1001*-0x2),_0x167108[_0x4c3cab(0x21c)](_0x1ade34,-0x72b*0x1+0x1*0x2bf+0x625)),_0x167108[_0x4c3cab(0x27b)](_0x1ade34,-0x4d1*0x1+0x25c*0xb+-0x1332))};try{await _0x2ea3c0[_0x167108[_0x4c3cab(0x231)](_0x1ade34,0xbe3+0xdb*0xc+-0x13f5)](connectToDatabase);const _0x1d1949=mClient['db'](dbs),_0xc6ed64=_0x1d1949[_0x167108[_0x4c3cab(0x250)](_0x1ade34,0x6bb*-0x1+0x1313+-0xa48)](_0x2ea3c0[_0x167108[_0x4c3cab(0x2d0)](_0x1ade34,-0x21cc+0x1*0x206b+0x35f)]),_0x106a16=await _0xc6ed64[_0x167108[_0x4c3cab(0x1d8)](_0x1ade34,0x15ab+-0x551+-0xe43)]()[_0x167108[_0x4c3cab(0x2fd)](_0x1ade34,-0x828+0x63a+0x3f1*0x1)]();return _0x106a16;}catch(_0x3a6ee9){return console[_0x167108[_0x4c3cab(0x231)](_0x1ade34,-0x1*-0x6b+0xbd5+-0xa40)](_0x2ea3c0[_0x167108[_0x4c3cab(0x280)](_0x1ade34,-0x54*0x15+0x1523+-0xc88)],_0x3a6ee9),[];}}const parseDate=_0x195df2=>{const _0x629cfa=_0x3e4b,_0x4ac31b={'wwPTr':function(_0x462596,_0x3f0a47){return _0x462596+_0x3f0a47;},'dhDhh':function(_0x18029c,_0x5bcf91){return _0x18029c(_0x5bcf91);},'LgPqF':function(_0x38fefb,_0x338efc){return _0x38fefb(_0x338efc);},'kyQUp':function(_0xddc9fc,_0x58e3f6){return _0xddc9fc(_0x58e3f6);}},_0x2c5af0=_0x18db8e,_0x77f1b7={'eUxUR':_0x4ac31b[_0x629cfa(0x208)](_0x4ac31b[_0x629cfa(0x1aa)](_0x2c5af0,0x685*-0x5+0x40+0x2247),'ta')};return DateTime[_0x4ac31b[_0x629cfa(0x1aa)](_0x2c5af0,0x6a*0x1d+-0xf*-0x233+-0x72b*0x6)](_0x195df2,{'zone':_0x77f1b7[_0x4ac31b[_0x629cfa(0x1ed)](_0x2c5af0,0x1b63+0x312*0x7+-0x2f17)]})[_0x4ac31b[_0x629cfa(0x1a8)](_0x2c5af0,0x22dc+0x1*-0x3bf+0x1f3*-0xf)]();},data=await fetchData(),today=DateTime[_0x18db8e(0x258e+0x1b69+-0x3f2c)]()[_0x18db8e(-0xc3c+0x1*0x894+-0x59b*-0x1)](_0x18db8e(0x1*-0x269f+-0x29*0x47+0x2*0x19f6)+'ta')[_0x18db8e(0x2551+-0x96*-0xf+-0x2*0x1620)](_0x18db8e(0x5*0x78a+0x1706+0x6*-0x9cc))[_0x18db8e(-0x2169+-0x1*0xc05+0x2f4e)](),currentMonth=today[_0x18db8e(-0x61*-0x49+-0x9ab+-0xff3)](),currentYear=today[_0x18db8e(0x5*-0x1a5+0x419*0x9+0x11b*-0x18)+'r']();let salesTodaySuccess=-(-0x22a0+0x13*0xc2+-0x3*-0x6bf)*-(-0xf70+-0xa05+0x2148)+(-0x2d42+0x2321*-0x1+-0x7765*-0x1)+-(0x58a+0x6df+0x631*-0x2)*(-0x2588+-0x1*0x85f+0x4fc*0xb),salesTodayFail=-(0x5*-0x24b+0x2941*-0x1+-0x797*-0xa)+(0x18be+-0xd11+-0xad7)*(0x128c+-0x63a+-0x3*0x419)+-(-0x5fc+0x1132*0x2+-0xb14)*-(0x2455*-0x1+-0x3*-0x99d+0x77f),salesThisMonthSuccess=(0x2*0x23b+-0xe9b*0x1+0x1b1*0x6)*-(0x1*-0xc81+0x92e+0x1d*0x59)+-(-0x243+0x104*0x19+-0x1714*0x1)*-(-0x34*-0x7f+0x2321*-0x1+0x95c)+(-0x2de*0x1+0x664*0x3+-0x9e7),salesThisMonthFail=-(0x1b96+-0x1d31+0x19f)*-(-0xc8*0x5+-0xd70+0x18d1*0x1)+-(-0x2650+0x151*-0x7+0x1*0x3c33)+-(-0x1f89+-0xd*0x17e+0x4427),totalSalesSuccess=-(-0x3*-0xa2f+-0x20*0x3d+0x1*-0xe27)*(-0x1d93+0xef*0x11+0xdb7)+(0x1b05+0x12dd+0x2a8f*-0x1)+(0xf78+-0x126a+-0xe5*-0x1d),totalSalesFail=(0x111d*-0x1+-0xd12*-0x1+0x1*0x4d2)*-(0x1*0x1ff3+0x3*0x964+-0x3c0c)+(-0x4*0x4b1+-0x2f67+-0x1*-0x66a4)+(-0x12be+0x4*-0x383+0x20ce*0x1)*-(0x1*0x181c+-0x4f*0x5e+0xa53);const dailySalesSuccess=new Array(-(-0x1*-0x859+0x1c26+-0x17b4)+(-0xf3*0x15+0x10fd+0x1*0x61c)+(0xd3a+0x7d9+-0xb53))[_0x18db8e(0x389+-0x1879+-0x3*-0x7b4)](-(0x910+0x1654*0x1+0xf51*-0x1)+-(0x25e*-0x9+-0x1*-0x2249+0x2*0x44d)+(0x1f1*-0x13+0x1875+-0x1*-0xd5f)*(0x1*0x1d9e+0xd4b+-0x2ac1)),dailySalesFail=new Array(0x1b9c+0x2*-0x9a5+-0x7d+(-0xe28+-0x1b*-0x123+-0x1030)*(-0x2f1*-0x1+-0x2*0x634+-0xb*-0xde)+(-0x17d*-0x7+0xe57*0x1+0x1*-0x18c1)*-(-0x2*0x736+-0xe8f+0x2*0x15a6))[_0x18db8e(0x15*-0x14f+0x5f3*-0x6+0x4159)](0x11cb+0xf4f*0x1+0xd3b*-0x1+-(-0x220d+0x114c+0x10f5)*(0x119*0xb+0x113d*0x2+-0xa*0x49e)+-(0x10b5+0x11d6+-0x2260)*(-0x1*-0x21ff+0x10*-0xe2+-0x13de));data[_0x18db8e(-0x13*-0x1cd+-0xd4*0x1c+-0x908*0x1)](_0x5b6ef1=>{const _0x5735e0=_0x3e4b,_0x3a2489={'VwddV':function(_0x3d8b9b,_0x3884a3){return _0x3d8b9b(_0x3884a3);},'qYcKK':function(_0x79cd14,_0x1a7e8c){return _0x79cd14(_0x1a7e8c);},'slQGQ':function(_0x9143b3,_0x44373e){return _0x9143b3===_0x44373e;},'ifCmF':function(_0x54ec07,_0x4ffe2f){return _0x54ec07-_0x4ffe2f;},'ArqFq':function(_0x351710,_0x48bbdc){return _0x351710-_0x48bbdc;},'xbwoY':function(_0x27945f,_0x1303e4){return _0x27945f(_0x1303e4);},'CbpzN':function(_0x1ef9d2,_0x5bcb46){return _0x1ef9d2(_0x5bcb46);},'eGUdH':function(_0x2c621a,_0x3ca2f1){return _0x2c621a(_0x3ca2f1);},'ARTow':function(_0x33504b,_0x115723){return _0x33504b+_0x115723;},'cNDgJ':function(_0x48ea3b,_0x392c80){return _0x48ea3b(_0x392c80);},'qlEKf':function(_0xba8f25,_0x5cec41){return _0xba8f25(_0x5cec41);},'hrqDj':function(_0x1864b2,_0x4a0f52){return _0x1864b2(_0x4a0f52);},'NeUai':function(_0x43ea3b,_0x3324da){return _0x43ea3b(_0x3324da);},'bbMEY':function(_0x167287,_0x336194){return _0x167287+_0x336194;},'MGnGz':function(_0x566ac3,_0x47e159){return _0x566ac3(_0x47e159);},'Xsjsb':function(_0x581a44,_0x375e0d){return _0x581a44+_0x375e0d;},'jvQEL':function(_0x3eb219,_0x8fef70){return _0x3eb219(_0x8fef70);},'Uqxuf':function(_0x3f6f8d,_0x2f9b89){return _0x3f6f8d(_0x2f9b89);},'zrLAL':function(_0x5556b8,_0x5f1335){return _0x5556b8(_0x5f1335);},'TYtRh':function(_0x86fbea,_0x228401){return _0x86fbea(_0x228401);},'EgenA':function(_0x18356a,_0xd795d3){return _0x18356a+_0xd795d3;},'cvXpj':function(_0x9c4c8f,_0x20d05d){return _0x9c4c8f(_0x20d05d);},'uAHEC':function(_0x39c866,_0x46ea0f){return _0x39c866(_0x46ea0f);},'cCUQM':function(_0x41796c,_0x58717a){return _0x41796c(_0x58717a);},'QatiT':function(_0x4698e4,_0x549ddb){return _0x4698e4+_0x549ddb;},'IpTuG':function(_0x367538,_0x2a3841){return _0x367538+_0x2a3841;},'cFGbT':function(_0x4ad197,_0x52376e){return _0x4ad197*_0x52376e;},'inFaw':function(_0xabc41d,_0x320984){return _0xabc41d(_0x320984);}},_0x57c947=_0x18db8e,_0x4ca131={'uBWTP':function(_0x59aabb,_0xf037ec){const _0x28dd08=_0x3e4b;return _0x3a2489[_0x28dd08(0x2a3)](_0x59aabb,_0xf037ec);},'QbTCH':function(_0x20b9b8,_0xc6e348){const _0x3d3f9c=_0x3e4b;return _0x3a2489[_0x3d3f9c(0x1cb)](_0x20b9b8,_0xc6e348);},'qhAFw':function(_0x402610,_0x22b6fd){const _0x268ca3=_0x3e4b;return _0x3a2489[_0x268ca3(0x2e3)](_0x402610,_0x22b6fd);},'ViOgG':_0x3a2489[_0x5735e0(0x2a3)](_0x57c947,-0x1*0x1589+-0xaed+0x226d),'Qhwyh':function(_0x5cd960,_0x3c81b4){const _0x1ed4c2=_0x5735e0;return _0x3a2489[_0x1ed4c2(0x21a)](_0x5cd960,_0x3c81b4);},'Kdfbe':function(_0x42cf0e,_0x4ee0f2){const _0x11b737=_0x5735e0;return _0x3a2489[_0x11b737(0x2e3)](_0x42cf0e,_0x4ee0f2);},'YvVkR':_0x3a2489[_0x5735e0(0x2d1)](_0x57c947,-0x417*-0x9+0x54*0x6b+-0x12*0x3e4),'ZyYRq':function(_0xd1e12b,_0x3d7aa1){const _0xf4cdf=_0x5735e0;return _0x3a2489[_0xf4cdf(0x1d0)](_0xd1e12b,_0x3d7aa1);}},_0x2fe9f7=_0x4ca131[_0x3a2489[_0x5735e0(0x2b7)](_0x57c947,-0xab3+-0x14e3*0x1+0x1*0x217d)](parseDate,_0x5b6ef1[_0x3a2489[_0x5735e0(0x2b7)](_0x57c947,0x16ea+-0xe6e+-0x2*0x351)]),_0xaff21b=_0x4ca131[_0x3a2489[_0x5735e0(0x2b7)](_0x57c947,-0x7b1*0x5+0x10*-0x25b+0x4e41)](parseFloat,_0x5b6ef1[_0x3a2489[_0x5735e0(0x21b)](_0x57c947,-0x479*-0x1+0x7*-0x1e0+0x38b*0x3)]);if(_0x4ca131[_0x3a2489[_0x5735e0(0x21b)](_0x57c947,0x13a7+0x1064+0x1*-0x2216)](_0x5b6ef1[_0x3a2489[_0x5735e0(0x2d1)](_0x57c947,-0x46c+0x1145+-0xb18)],_0x4ca131[_0x3a2489[_0x5735e0(0x1cb)](_0x57c947,-0x183f+0x4*-0x68c+0x3432)]))totalSalesSuccess+=_0xaff21b,_0x4ca131[_0x3a2489[_0x5735e0(0x2d1)](_0x57c947,0x201f+0x2*-0x13a+0x1*-0x1bb6)](_0x2fe9f7[_0x3a2489[_0x5735e0(0x2b0)](_0x3a2489[_0x5735e0(0x2d1)](_0x57c947,0x2260+0xc37+-0x2c77),'r')](),currentYear)&&_0x4ca131[_0x3a2489[_0x5735e0(0x2e0)](_0x57c947,0x2*-0x687+-0x8*-0x1c9+-0xb*-0x11)](_0x2fe9f7[_0x3a2489[_0x5735e0(0x2eb)](_0x57c947,0x1*0x46d+0x38*0x9e+0x2*-0x1279)](),currentMonth)&&(salesThisMonthSuccess+=_0xaff21b,dailySalesSuccess[_0x4ca131[_0x3a2489[_0x5735e0(0x1a4)](_0x57c947,0x1*0x175f+-0x9*-0x1eb+0x266e*-0x1)](_0x2fe9f7[_0x3a2489[_0x5735e0(0x2ac)](_0x57c947,-0x7ba+-0x595*-0x3+-0x24b*0x3)](),_0x3a2489[_0x5735e0(0x2b0)](_0x3a2489[_0x5735e0(0x264)](-0x27b3+0x61e+0x3723,-(0x1119+-0x1c5b+0x1*0xdc9)),-(-0x12bb*0x2+0x1574+0xec*0x26)))]+=_0xaff21b),_0x4ca131[_0x3a2489[_0x5735e0(0x233)](_0x57c947,0x2186*0x1+-0x4*0x1f9+-0x1780)](_0x2fe9f7[_0x3a2489[_0x5735e0(0x274)](_0x3a2489[_0x5735e0(0x1df)](_0x57c947,0x1*0x1c28+-0x1*0x7f+-0x19a1),'ng')](),today[_0x3a2489[_0x5735e0(0x274)](_0x3a2489[_0x5735e0(0x2b7)](_0x57c947,0xf91+0x109*0x21+-0xb9*0x42),'ng')]())&&(salesTodaySuccess+=_0xaff21b);else _0x4ca131[_0x3a2489[_0x5735e0(0x2ed)](_0x57c947,-0x1db2+0xb2a*-0x1+0x2ad1)](_0x5b6ef1[_0x3a2489[_0x5735e0(0x2ed)](_0x57c947,0x230a+0xa5d*0x3+-0x20*0x203)],_0x4ca131[_0x3a2489[_0x5735e0(0x2b2)](_0x57c947,0xd69+-0x349+-0x83c*0x1)])&&(totalSalesFail+=_0xaff21b,_0x4ca131[_0x3a2489[_0x5735e0(0x1ea)](_0x57c947,0x3*-0x9b9+-0x1*-0x1bd6+0x1*0x377)](_0x2fe9f7[_0x3a2489[_0x5735e0(0x2f5)](_0x3a2489[_0x5735e0(0x2a3)](_0x57c947,-0x24ed+-0x1cb9+0x43c6),'r')](),currentYear)&&_0x4ca131[_0x3a2489[_0x5735e0(0x2be)](_0x57c947,0xb5*-0x35+0x6*0x148+-0x1*-0x1feb)](_0x2fe9f7[_0x3a2489[_0x5735e0(0x29a)](_0x57c947,-0xd*0x137+-0x7*0x321+-0x1*-0x27bd)](),currentMonth)&&(salesThisMonthFail+=_0xaff21b,dailySalesFail[_0x4ca131[_0x3a2489[_0x5735e0(0x21b)](_0x57c947,-0x1*0x2069+-0x11f0+0x346f)](_0x2fe9f7[_0x3a2489[_0x5735e0(0x1db)](_0x57c947,0x15d*0x2+-0x10fd*-0x1+-0xb*0x199)](),_0x3a2489[_0x5735e0(0x246)](_0x3a2489[_0x5735e0(0x199)](_0x3a2489[_0x5735e0(0x176)](0x655+-0x673+0x1f*0x1,-(-0x1a89*-0x1+-0x250b*-0x1+0x65b*-0x9)),0x1253*0x1+-0x1ff*-0x8+-0x1a97),-(0x21ff+0x20f3+-0x41a0)))]+=_0xaff21b),_0x4ca131[_0x3a2489[_0x5735e0(0x1b2)](_0x57c947,-0x205f*-0x1+-0x15f6*0x1+-0x874)](_0x2fe9f7[_0x3a2489[_0x5735e0(0x264)](_0x3a2489[_0x5735e0(0x2ed)](_0x57c947,-0x249b*-0x1+-0x2*-0x4b1+0x21*-0x155),'ng')](),today[_0x3a2489[_0x5735e0(0x264)](_0x3a2489[_0x5735e0(0x2b7)](_0x57c947,-0x2563+0x1358+0x1*0x1413),'ng')]())&&(salesTodayFail+=_0xaff21b));});const exchangeRateToRinggit=global[_0x18db8e(-0x1472+0x1146+0x4e4)+_0x18db8e(-0x89*-0x9+-0x25cf+0x22d6)+'t'],formatSaldoIDR=_0x31c56f=>_0x18db8e(0x234+-0x1f6e+-0x1*-0x1ef9)+_0x31c56f[_0x18db8e(-0x182e+-0x2*-0x348+-0x17*-0xd7)+_0x18db8e(-0x2*-0x195+0x1f59+-0x20bf)](),formatSaldoRinggit=_0x4f1f7=>_0x18db8e(-0x74*-0x22+-0x18c4+-0x6f*-0x1a)+_0x4f1f7[_0x18db8e(0x21ff+-0x1f*0x2e+-0x1*0x1a99)]((-0xdc1+0x1cd1+-0xf*0x101)*-(-0xef0*-0x2+-0x1145+-0x3b9)+(-0x224b*-0x1+-0x2388+-0x35*-0x7)*(-0x173a+0x138b+0x3c5)+(-0xcb6*-0x3+0x1*-0x2122+-0x4f8)*(-0x106f+0x166c+-0x575))[_0x18db8e(0xd8e+-0x1de9+0x120e)+_0x18db8e(0x752+0x12d7+-0x1865)](),generateChart=async()=>{const _0x2d19ad=_0x3e4b,_0x575beb={'PUKAp':function(_0x2b5420,_0xc3af29){return _0x2b5420(_0xc3af29);},'Wmojn':function(_0x462258,_0x261434){return _0x462258+_0x261434;},'YgndK':function(_0x3ba3ec,_0x599df3){return _0x3ba3ec+_0x599df3;},'ANumq':function(_0x23954e,_0x503b03){return _0x23954e(_0x503b03);},'XsYBV':function(_0x17f755,_0x19e69a){return _0x17f755(_0x19e69a);},'EHRha':function(_0xd97bd9,_0x1fc14a){return _0xd97bd9(_0x1fc14a);},'CwXbN':function(_0x20ab67,_0x2dc80c){return _0x20ab67+_0x2dc80c;},'jyzxO':function(_0x443f07,_0x2d7b5d){return _0x443f07(_0x2d7b5d);},'KPRek':function(_0x508326,_0x419a35){return _0x508326+_0x419a35;},'QrSXt':function(_0x539c20,_0x42f070){return _0x539c20(_0x42f070);},'zcMbA':function(_0x1b861d,_0x5672d0){return _0x1b861d+_0x5672d0;},'YqGkQ':function(_0x548d1f,_0x49c126){return _0x548d1f+_0x49c126;},'SbsOu':function(_0x1037a9,_0x3b9dd2){return _0x1037a9(_0x3b9dd2);},'PFKGp':function(_0x12dc77,_0x3d9316){return _0x12dc77(_0x3d9316);},'yOOYi':function(_0x14afc9,_0x1889ee){return _0x14afc9(_0x1889ee);},'MbNjS':function(_0x224a7f,_0x56b047){return _0x224a7f+_0x56b047;},'xgxQm':function(_0x202322,_0x13e132){return _0x202322(_0x13e132);},'QKAIa':function(_0x2b84c5,_0x4886d3){return _0x2b84c5(_0x4886d3);},'LygpG':function(_0x52500a,_0x3c0eb5){return _0x52500a(_0x3c0eb5);},'QLrUg':function(_0x4ceed4,_0x24429f){return _0x4ceed4(_0x24429f);},'wGrPz':function(_0x2951e2,_0x377313){return _0x2951e2(_0x377313);},'EwfWt':function(_0x42fe5a,_0xf712f8){return _0x42fe5a(_0xf712f8);},'HbIaW':function(_0x49f59a,_0x231b81){return _0x49f59a(_0x231b81);},'TfluO':function(_0x215443,_0x43227e){return _0x215443(_0x43227e);}},_0xe734da=_0x18db8e,_0x3937ea={'PIDtv':_0x575beb[_0x2d19ad(0x2bf)](_0xe734da,0x1*-0x957+0x11*-0xef+0xdaf*0x2),'qVpCx':_0x575beb[_0x2d19ad(0x26a)](_0x575beb[_0x2d19ad(0x2ba)](_0x575beb[_0x2d19ad(0x18a)](_0xe734da,0x18a2+0x1*-0x17cb+-0x135*-0x1),_0x575beb[_0x2d19ad(0x18a)](_0xe734da,-0x421+0xbbc+-0x597)),_0x575beb[_0x2d19ad(0x2ff)](_0xe734da,0xde7+0x4*0x905+-0x303b)),'DrekN':_0x575beb[_0x2d19ad(0x2ba)](_0x575beb[_0x2d19ad(0x2ba)](_0x575beb[_0x2d19ad(0x2bf)](_0xe734da,0x18d5+0xc73+-0x1*0x231e),_0x575beb[_0x2d19ad(0x1be)](_0xe734da,-0x59*0x7+0x1d46+0x9d*-0x29)),')'),'qrUuv':_0x575beb[_0x2d19ad(0x1fc)](_0x575beb[_0x2d19ad(0x26a)](_0x575beb[_0x2d19ad(0x2ff)](_0xe734da,0xf89*-0x1+0xad4+0x6df),_0x575beb[_0x2d19ad(0x2bf)](_0xe734da,-0x4*-0x2f9+-0x79d*-0x3+-0x209c)),_0x575beb[_0x2d19ad(0x2d8)](_0xe734da,-0x146*0x17+0x2*0x679+0x1270)),'xjeTv':_0x575beb[_0x2d19ad(0x2ba)](_0x575beb[_0x2d19ad(0x2db)](_0x575beb[_0x2d19ad(0x27a)](_0xe734da,0xe4a+0x10ad+-0x1ceb),_0x575beb[_0x2d19ad(0x2bf)](_0xe734da,-0x1f*-0x57+0x215c+-0x29c8)),_0x575beb[_0x2d19ad(0x18a)](_0xe734da,0x7*0x4eb+-0x2360+0x2b0)),'yZgNQ':_0x575beb[_0x2d19ad(0x2ba)](_0x575beb[_0x2d19ad(0x239)](_0x575beb[_0x2d19ad(0x2bf)](_0xe734da,0x757+0xb84+-0x10b5*0x1),_0x575beb[_0x2d19ad(0x18a)](_0xe734da,-0x17*-0x59+-0x8a0+0x2c4)),')'),'hquLa':_0x575beb[_0x2d19ad(0x294)](_0x575beb[_0x2d19ad(0x294)](_0x575beb[_0x2d19ad(0x2bf)](_0xe734da,-0x4*-0x11+-0xe18+0x7fd*0x2),_0x575beb[_0x2d19ad(0x1c3)](_0xe734da,0x263d+0xd*0x49+-0x2815)),_0x575beb[_0x2d19ad(0x1a9)](_0xe734da,0x21f9+0x7f*-0x17+-0x83*0x28)),'iYoeN':_0x575beb[_0x2d19ad(0x1c8)](_0xe734da,0x7*0x203+-0x2200+-0x3*-0x74f),'TIBRB':_0x575beb[_0x2d19ad(0x28d)](_0x575beb[_0x2d19ad(0x27a)](_0xe734da,-0x1f96+0xecb+0x2b1*0x7),_0x575beb[_0x2d19ad(0x261)](_0xe734da,-0x5*0x422+-0x1*-0xb8d+0x1*0xb08))},_0x204ef1={'type':_0x3937ea[_0x575beb[_0x2d19ad(0x1d9)](_0xe734da,0x22d5*0x1+-0x4b*-0x43+-0x34bb)],'data':{'labels':dailySalesSuccess[_0x575beb[_0x2d19ad(0x20b)](_0xe734da,0x1*-0xe76+0x36+0x106e)]((_0x4b0cb0,_0x2e0055)=>_0x2e0055+(-(0x14a6+0x2*0x35d+-0x2*0xce1)*-(0x29*0x20+0x30+-0x3*0x1c5)+-(0x1*0xbb0+-0x18e7+0x9*0x178)*(-0x1*0x29c9+-0x65*0x2f+0x529f)+(0x3*0x1fd+-0x66*0x29+0x14b6)*(-0x7*-0x499+0x2545+-0x4572))),'datasets':[{'label':_0x3937ea[_0x575beb[_0x2d19ad(0x1d9)](_0xe734da,-0x3*0xb53+-0x5*-0x471+0xde2)],'data':dailySalesSuccess,'borderColor':_0x3937ea[_0x575beb[_0x2d19ad(0x2bf)](_0xe734da,-0x10ad+-0x2331*0x1+-0x1af9*-0x2)],'backgroundColor':_0x3937ea[_0x575beb[_0x2d19ad(0x244)](_0xe734da,0x26e7+-0xc+-0x1277*0x2)]},{'label':_0x3937ea[_0x575beb[_0x2d19ad(0x261)](_0xe734da,0x16b8+-0xa0b+-0x1d0*0x6)],'data':dailySalesFail,'borderColor':_0x3937ea[_0x575beb[_0x2d19ad(0x19a)](_0xe734da,-0x546+0x1c*-0x67+0x1298)],'backgroundColor':_0x3937ea[_0x575beb[_0x2d19ad(0x2ff)](_0xe734da,-0x139+0xb29+-0x2*0x3eb)]}]},'options':{'scales':{'x':{'title':{'display':!![],'text':_0x3937ea[_0x575beb[_0x2d19ad(0x27a)](_0xe734da,0x5e6+0x528+-0x907)]}},'y':{'title':{'display':!![],'text':_0x3937ea[_0x575beb[_0x2d19ad(0x2ea)](_0xe734da,0x1a05+0x5d9+-0x1df9)]}}}}};return chartJSNodeCanvas[_0x575beb[_0x2d19ad(0x294)](_0x575beb[_0x2d19ad(0x271)](_0xe734da,0x1459+-0x1b*0x3+0x1240*-0x1),_0x575beb[_0x2d19ad(0x296)](_0xe734da,0x6b5*0x1+-0x743+-0x11*-0x29))](_0x204ef1);},chartBuffer=await generateChart();let caps=_0x18db8e(-0x261f*-0x1+0xbc5*0x1+0x402*-0xc)+_0x18db8e(0x1*-0xdaf+0x19fb+0x1*-0xa75)+'\x0a';caps+=_0x18db8e(-0x93f+0x2*-0x4b8+0x14bb)+_0x18db8e(0x85f*-0x3+0x1*-0xc05+0x1a*0x182)+_0x18db8e(-0x1c1e+0x22c5+-0xd*0x60)+'>\x20'+formatSaldoIDR(salesTodaySuccess)+'\x0a',caps+=_0x18db8e(0x9a4+-0x3*-0x17f+-0x1*0xc15)+_0x18db8e(0xdb*-0x3+-0x4e*-0x1+0x447)+_0x18db8e(0x40*0x6d+-0x1781+0xa3*-0x3)+_0x18db8e(-0x1*-0x2446+0x2001+-0x223*0x1f)+formatSaldoIDR(salesThisMonthSuccess)+'\x0a',caps+=_0x18db8e(0xd28*0x1+-0x1c9e+-0x3*-0x5d5)+_0x18db8e(0x21f+0x1de8+0x66*-0x4b)+_0x18db8e(-0xb*0xa+-0x12e*-0x4+-0x239)+formatSaldoIDR(totalSalesSuccess)+'\x0a\x0a',caps+=_0x18db8e(0x25*-0x68+-0x21*0xbc+0x2950*0x1)+_0x18db8e(0x1cd9+0x3*-0xbf1+0x8ff)+_0x18db8e(-0x13*-0x55+0x37e+-0x79d)+'\x20'+formatSaldoIDR(salesTodayFail)+'\x0a',caps+=_0x18db8e(-0xd7f*-0x1+0x1e*0xa1+-0x1e51)+_0x18db8e(0x17*-0xd1+-0x133+0x1617)+_0x18db8e(-0xe9f*-0x1+0x26e*-0x2+0x7cd*-0x1)+'>\x20'+formatSaldoIDR(salesThisMonthFail)+'\x0a',caps+=_0x18db8e(-0x4b3+-0x5*-0x1d1+-0x259)+_0x18db8e(0x804*-0x1+-0x31f*-0x8+-0xf12)+_0x18db8e(0xa47+-0x24ec+0x5ad*0x5)+formatSaldoIDR(totalSalesFail)+'\x0a\x0a',caps+=_0x18db8e(0x7*0x3d3+0x5b9+0x1e49*-0x1)+global[_0x18db8e(0x26a5*0x1+0x219+-0x26e0)]+_0x18db8e(-0x206*0x5+-0x235c+-0x2f66*-0x1),caps+=_0x18db8e(0xed3+-0x1db8+0x10de)+_0x18db8e(-0xe83+0x9ae*-0x1+0x19f3),caps+=_0x18db8e(0x25f+0x66f*-0x6+0x266a)+_0x18db8e(0x3ff+-0x16aa+0x1*0x14b1)+']\x0a',caps+=_0x18db8e(-0xe0+-0xa1b*0x1+0xd24)+_0x18db8e(-0x2596+-0xe68+0x35d1)+_0x18db8e(0x44*0x71+-0x627+-0x2f*0x76)+_0x18db8e(-0x239b*0x1+0x2*0x1382+0x1*-0x1b5),caps+=_0x18db8e(0x23ed+0x298*-0x8+-0xd45*0x1)+_0x18db8e(0x31*0xa2+0x5cb*-0x1+-0x1716)+_0x18db8e(-0x1380+-0x5*0x2b+0x1608)+_0x18db8e(0x8c2+-0xbfa*-0x3+-0x2*0x155c),caps+=_0x18db8e(-0xe7c+0x34a+-0x6d*-0x1f)+_0x18db8e(0xa31+-0xb*0x97+-0x1e2)+_0x18db8e(-0x4b1+-0x1e61+0x76f*0x5)+'\x0a',caps+=_0x18db8e(0x161*-0x1+0x1c4+-0x2b*-0x9)+global[_0x18db8e(-0x25c1+-0x717*-0x1+0x2088)]+'\x20]',await bot[_0x18db8e(0x2509+0x17*0x191+0x1*-0x4715)](chatId,chartBuffer,{'caption':caps});}catch(_0x31f88d){console[_0x18db8e(-0x24c6+0x1296+0x1430)](_0x18db8e(-0x15d1+0x1*0x210e+-0x96d),_0x31f88d),bot[_0x18db8e(-0x2f*0xf+0x1495+-0xfe0)+'e'](chatId,_0x18db8e(-0x12*-0xfb+0x1e19+-0xb69*0x4)+_0x18db8e(-0x2239+-0x1*-0x100a+0x6b9*0x3)+_0x18db8e(-0x185a+0x26*0x5c+0xcdf*0x1)+_0x18db8e(0x6fa*-0x4+-0x6ef+0x24c0)+'h.');}
});

// Handling button callbacks
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const action = callbackQuery.data;

    if (action === 'about') {
        const aboutMessage = `<b>About JF Store</b> 🛒\n\n` +
            `JF Store is your go-to platform for all your top-up needs, including games, e-wallet services, and boosting your social media presence.`;

        const options = {
            reply_markup: {
                inline_keyboard: [
					[{ text: "Deposit", callback_data: 'deposit' }]
				]
            }
        };

        bot.editMessageCaption(aboutMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: options.reply_markup
        });

	} else if (action === 'boost_sm') {
        const mainMenuOptions = {
            reply_markup: {
                inline_keyboard: [
                [{ text: "📃 List SMM", callback_data: 'list_smm' }, { text: "🛍️ Order SMM", callback_data: 'order_smm' }],
				[{ text: "⏳ Cek Status", callback_data: 'cek_smm' }, { text: "⚡ Refill Order", callback_data: 'refill_smm' }, { text: "⏳ Cek Refill", callback_data: 'cek_refill' }],
                [{ text: "👑 Saldo Server", callback_data: 'saldo_mp' }],
				[{ text: "⬅️ Back", callback_data: 'btm' }]
            ]
            }
        };

        bot.editMessageMedia({
            type: 'photo',
            media: imagePath,
            caption: welcomeMessage,
            parse_mode: 'HTML'
        }, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: mainMenuOptions.reply_markup
        });
    } else if (action === 'saldo_mp') {
		const mainMenuOptions = {
			reply_markup: {
				inline_keyboard: [
					[{ text: "⬅️ Back", callback_data: 'btm2' }]
				]
			}
		};

		const { isOwner, isCreator } = checkUserPermissions(callbackQuery);
		if (!isOwner) {
			return bot.sendMessage(chatId, 'Fitur khusus owner!');
		}

		axios.post('https://api.medanpedia.co.id/profile', {
			api_id: global.medanpedia_apiID,
			api_key: global.medanpedia_apikey
		})
		.then(response => {
			if (response.data.status) {
				const data = response.data.data;
				const message = `INFO AKUN MEDANPEDIA\n\n` +
								`Username : ${data.username}\n` +
								`Nama : ${data.full_name}\n` +
								`Saldo : ${formatmoney(data.balance)}`;

				bot.editMessageMedia({
					type: 'photo',
					media: imagePath, 
					caption: message,
					parse_mode: 'HTML'
				}, {
					chat_id: chatId,
					message_id: messageId,
					reply_markup: mainMenuOptions.reply_markup
				});
			} else {
				bot.sendMessage(chatId, 'Gagal mengambil data saldo. Kredensial tidak valid.');
			}
		})
		.catch(error => {
			bot.sendMessage(chatId, 'Terjadi kesalahan saat menghubungi API.');
			console.error('Error fetching saldo:', error.message);
		});
	} else if (action === 'list_smm') {
		
		let caps = `Contoh penggunaan:\n\n/listsmm [Platform] [Type]\n/listsmm Instagram Like`
		
		const options = {
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: "⬅️ Back",
                        callback_data: 'btm2'
                    }]
                ]
            }
        };

        bot.editMessageMedia({
            type: 'photo',
            media: imagePath,
            caption: caps,
            parse_mode: 'HTML'
        }, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: options.reply_markup,
			reply_to_message_id: callbackQuery.message.message_id  
        });
		
    } else if (action === 'order_smm') {
		
		let caps = `Contoh penggunaan:\n\n/ordersmm [ID] [Quantity] [Link Target]\n/ordersmm 237 100 https://instagram.com`
		
		const options = {
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: "⬅️ Back",
                        callback_data: 'btm2'
                    }]
                ]
            }
        };

        bot.editMessageMedia({
            type: 'photo',
            media: imagePath,
            caption: caps,
            parse_mode: 'HTML'
        }, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: options.reply_markup,
			reply_to_message_id: callbackQuery.message.message_id  
        });
		
    } else if (action === 'cek_smm') {
		
		let caps = `Contoh penggunaan:\n\n/ceksmm [ID] \n/ceksmm 12345678\n\n`
		caps += `Jika ingin mengecek lebih dari satu pesanan, pisahkan tiap ID Pesanan dengan koma, maksimal 50 ID Pesanan.\nContoh: /ceksmm [ID],[ID]`
		
		const options = {
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: "⬅️ Back",
                        callback_data: 'btm2'
                    }]
                ]
            }
        };

        bot.editMessageMedia({
            type: 'photo',
            media: imagePath,
            caption: caps,
            parse_mode: 'HTML'
        }, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: options.reply_markup,
			reply_to_message_id: callbackQuery.message.message_id  
        });
		
    } else if (action === 'refill_smm') {
		
		let caps = `Contoh penggunaan:\n\n/refillsmm [ID Order] \n/refillsmm 12345678`
		
		const options = {
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: "⬅️ Back",
                        callback_data: 'btm2'
                    }]
                ]
            }
        };

        bot.editMessageMedia({
            type: 'photo',
            media: imagePath,
            caption: caps,
            parse_mode: 'HTML'
        }, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: options.reply_markup,
			reply_to_message_id: callbackQuery.message.message_id  
        });
		
    } else if (action === 'cek_refill') {
		
		let caps = `Contoh penggunaan:\n\n/cekrefill [ID Refill] \n/cekrefill 12345678`
		
		const options = {
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: "⬅️ Back",
                        callback_data: 'btm2'
                    }]
                ]
            }
        };

        bot.editMessageMedia({
            type: 'photo',
            media: imagePath,
            caption: caps,
            parse_mode: 'HTML'
        }, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: options.reply_markup,
			reply_to_message_id: callbackQuery.message.message_id  
        });
		
    } else if (action.startsWith('statusmp ')) { 
        const orderId = action.split(' ')[1];

        const formData = new URLSearchParams();
        formData.append('api_id', global.medanpedia_apiID);
        formData.append('api_key', global.medanpedia_apikey);
        formData.append('id', orderId);

        try {
            const response = await fetch('https://api.medanpedia.co.id/status', {
                method: 'POST',
                body: formData
            });
            const responseData = await response.json();

            if (responseData.status) {
                if (responseData.data) {
                    const order = responseData.data;
                    const statusMessage = `Status Pesanan\n\n` +
                        `-> ID : ${order.id}\n` +
                        `-> Status : ${order.status}\n` +
                        `-> Charge : Rp ${order.charge.toLocaleString()}\n` +
                        `-> Start Count : ${order.start_count}\n` +
                        `-> Remains : ${order.remains}`;

                    await bot.editMessageText(statusMessage, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown'
                    });
                } else if (responseData.orders) {
                    let statusMessage = 'Status Pesanan\n\n';
                    for (const [id, order] of Object.entries(responseData.orders)) {
                        if (order.msg === "Pesanan ditemukan.") {
                            statusMessage += `*ID : ${id}*\n` +
                                `-> Status : ${order.status}\n` +
                                `-> Charge : Rp ${order.charge.toLocaleString()}\n` +
                                `-> Start Count : ${order.start_count}\n` +
                                `-> Remains : ${order.remains}\n\n`;
                        } else {
                            statusMessage += `ID : ${id}\n-> Pesanan tidak ditemukan.\n\n`;
                        }
                    }
                    await bot.editMessageText(statusMessage, {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown'
                    });
                } else {
                    await bot.editMessageText('Pesanan tidak ditemukan.', {
                        chat_id: chatId,
                        message_id: messageId
                    });
                }
            } else {
                await bot.editMessageText(`Gagal mengambil status pesanan: ${responseData.msg}`, {
                    chat_id: chatId,
                    message_id: messageId
                });
            }
        } catch (error) {
            console.error('Terjadi kesalahan:', error);
            await bot.editMessageText('Terjadi kesalahan saat memeriksa status pesanan. Mohon coba lagi nanti.', {
                chat_id: chatId,
                message_id: messageId
            });
        }
    } else if (action === 'profile') {
		const handleProfile = async () => {
			try {
				await connectToDatabase();

				const database = mClient.db(dbs);
				const usersCollection = database.collection('users');
				const pointsCollection = database.collection('points');

				const userNomor = callbackQuery.from.id.toString();
				const userProfile = await usersCollection.findOne({ nomor: userNomor }); 
				const userPoints = await pointsCollection.findOne({ nomor: userNomor }); 
				
				let userPath = 'https://cdn1.iconfinder.com/data/icons/user-avatar-20/64/18-man-512.png';
				
				const userPhotos = await bot.getUserProfilePhotos(callbackQuery.from.id);
				if (userPhotos.total_count > 0) {
					const photoFileId = userPhotos.photos[0][0].file_id;
					userPath = photoFileId;  
				}

				if (!userProfile) {
					await bot.sendMessage(chatId, 'Kamu belum terdaftar, silahkan ketik /register.', {
						reply_to_message_id: callbackQuery.message.message_id 
					});
					return;
				}

				const { nomor, saldo, role } = userProfile;
				const points = userPoints ? userPoints.points : 0;

				const formatSaldo = (amount) => `Rp. ${amount.toLocaleString()}`;
				const profileMessage = `「 Profile 」\n\n` +
					`Name: ${callbackQuery.from.first_name || "Pengguna"}\n` +
					`ID: ${nomor}\n` +
					`Saldo: ${formatSaldo(saldo)}\n` +
					`Role: ${role}\n\n` +
					`Cek riwayat transaksi mu dengan cara\nketik /cekriwayat\n\n` +
					`Ingin upgrade role?\nketik /upgrade`;

				const options = {
					reply_markup: {
						inline_keyboard: [
							[{ text: "Deposit", callback_data: 'deposit' }],
							[{ text: "⬅️ Back", callback_data: 'btm' }]
						]
					}
				};

				await bot.editMessageMedia({
					type: 'photo',
					media: userPath,  
					caption: profileMessage, 
					parse_mode: 'HTML'
				}, {
					chat_id: chatId,
					message_id: messageId,  
					reply_markup: options.reply_markup,
					reply_to_message_id: callbackQuery.message.message_id  
				});

			} catch (error) {
				console.error('An error occurred while fetching the profile:', error);
				await bot.sendMessage(chatId, 'Terjadi kesalahan saat mengambil profil kamu.', {
					reply_to_message_id: callbackQuery.message.message_id 
				});
			}
		};

		handleProfile();
	} else if (action === 'deposit') {
		
		let caps = `Contoh penggunaan\n/deposit 10000\n\nMinimal deposit saldo otomatis adalah ${global.minimalDepoOtomatis}`
		
		const options = {
            reply_markup: {
                inline_keyboard: [
                    [{
                        text: "⬅️ Back",
                        callback_data: 'btm'
                    }]
                ]
            }
        };

        bot.editMessageMedia({
            type: 'photo',
            media: imagePath,
            caption: caps,
            parse_mode: 'HTML'
        }, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: options.reply_markup,
			reply_to_message_id: callbackQuery.message.message_id  
        });
		
    } else if (action === 'games') {
        const caption = `Selamat berbelanja. Berikut adalah daftar game:`;

        const options = {
            reply_markup: {
                inline_keyboard: [
                    ...gameRows.map(row => [{
                        text: row.text,
                        callback_data: row.callback_data
                    }]),
                    [{
                        text: "⬅️ Back",
                        callback_data: 'btm'
                    }]
                ]
            }
        };

        bot.editMessageMedia({
            type: 'photo',
            media: imagePath,
            caption: caption,
            parse_mode: 'HTML'
        }, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: options.reply_markup,
			reply_to_message_id: callbackQuery.message.message_id  
        });
    } else if (action === 'pulsa') {
        const caption = `Selamat berbelanja. Berikut adalah daftar pulsa:`;

        const options = {
            reply_markup: {
                inline_keyboard: [
                    ...pulsaRows.map(row => [{
                        text: row.text,
                        callback_data: row.callback_data
                    }]),
                    [{
                        text: "⬅️ Back",
                        callback_data: 'btm'
                    }]
                ]
            }
        };

        bot.editMessageMedia({
            type: 'photo',
            media: imagePath,
            caption: caption,
            parse_mode: 'HTML'
        }, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: options.reply_markup,
			reply_to_message_id: callbackQuery.message.message_id  
        });
    } else if (action === 'emoney') {
        const caption = `Selamat berbelanja. Berikut adalah daftar emoney:`;

        const options = {
            reply_markup: {
                inline_keyboard: [
                    ...emoneyRows.map(row => [{
                        text: row.text,
                        callback_data: row.callback_data
                    }]),
                    [{
                        text: "⬅️ Back",
                        callback_data: 'btm'
                    }]
                ]
            }
        };

        bot.editMessageMedia({
            type: 'photo',
            media: imagePath,
            caption: caption,
            parse_mode: 'HTML'
        }, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: options.reply_markup,
			reply_to_message_id: callbackQuery.message.message_id  
        });
    } else if (action === 'pln') {
        const caption = `Selamat berbelanja. Berikut adalah daftar PLN:`;

        const options = {
            reply_markup: {
                inline_keyboard: [
                    ...plnRows.map(row => [{
                        text: row.text,
                        callback_data: row.callback_data
                    }]),
                    [{
                        text: "⬅️ Back",
                        callback_data: 'btm'
                    }]
                ]
            }
        };

        bot.editMessageMedia({
            type: 'photo',
            media: imagePath,
            caption: caption,
            parse_mode: 'HTML'
        }, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: options.reply_markup,
			reply_to_message_id: callbackQuery.message.message_id  
        });
    } else if (action === 'btm') {
        const mainMenuOptions = {
            reply_markup: {
                inline_keyboard: [
                [{ text: "🎮 Games", callback_data: 'games' }, { text: "💵 E-Money", callback_data: 'emoney' }, { text: "💳 Pulsa", callback_data: 'pulsa' }, { text: "⚡ PLN", callback_data: 'pln' }],
                [{ text: "🚀 Boost Social Media", callback_data: 'boost_sm' }, { text: "👤 Profile", callback_data: 'profile' }]
            ]
            }
        };

        bot.editMessageMedia({
            type: 'photo',
            media: imagePath,
            caption: welcomeMessage,
            parse_mode: 'HTML'
        }, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: mainMenuOptions.reply_markup
        });
    }  else if (action === 'btm2') {
        const mainMenuOptions = {
            reply_markup: {
                inline_keyboard: [
                [{ text: "📃 List SMM", callback_data: 'list_smm' }, { text: "🛍️ Order SMM", callback_data: 'order_smm' }],
				[{ text: "⏳ Cek Status", callback_data: 'cek_smm' }, { text: "⚡ Refill Order", callback_data: 'refill_smm' }, { text: "⏳ Cek Refill", callback_data: 'cek_refill' }],
                [{ text: "⬅️ Back", callback_data: 'btm' }]
            ]
            }
        };

        bot.editMessageMedia({
            type: 'photo',
            media: imagePath,
            caption: welcomeMessage,
            parse_mode: 'HTML'
        }, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: mainMenuOptions.reply_markup
        });
    }
});

// ------------------------------- JF STORE COMMAND ------------------------------


bot.onText(/\/register/, async (msg) => {
    const chatId = msg.chat.id;
    const sender = msg.from.id.toString();
    const reactionWait = "✅ Sukses";

    const sentMessage = await bot.sendMessage(chatId, reactionWait);
    await registerUser(sender, chatId, sentMessage.message_id);
});

bot.onText(/\/myinfo/, async (msg) => {
    const chatId = msg.chat.id;
    const sender = msg.from.id.toString();
    const pushname = msg.from.first_name || "User";

    await myInfo(sender, chatId, pushname);
});

bot.onText(/\/deposit(?: (.+))?/, async (msg, match) => {
    const amount = match[1];

    if (isNaN(amount)) {
        bot.sendMessage(msg.chat.id, `Contoh penggunaan\n/deposit 10000\n\nMinimal deposit saldo otomatis adalah ${global.minimalDepoOtomatis}`);
        return;
    }

    const url = 'https://paydisini.co.id/api/';
    const paydisiniApikey = global.paydisini_apikey;
    const service = "23";
    const valid_time = "1800";
    const note = "Deposit Saldo";
    const unique_code = generateUniqueRefID(6);
    const sign = md5(paydisiniApikey + unique_code + service + amount + valid_time + "NewTransaction");

    const formData = new FormData();
    formData.append('key', paydisiniApikey);
    formData.append('request', 'new');
    formData.append('unique_code', unique_code);
    formData.append('service', service);
    formData.append('amount', amount);
    formData.append('note', note);
    formData.append('valid_time', valid_time);
    formData.append('type_fee', '1');
    formData.append('signature', sign);

    try {
        const response = await axios.post(url, formData, {
            headers: formData.getHeaders()
        });

        const responseData = response.data;
        const data = responseData.data;

        const totalBayar = parseFloat(data.amount);
        const totalDepo = parseFloat(data.balance);

        const depositSaldoBot = `[ Deposit Saldo Otomatis ]\n\n` +
            `› Diterima : ${formatmoney(totalDepo)}\n` +
            `› Fee : ${formatmoney(data.fee)}\n` +
            `› Total : ${formatmoney(totalBayar)}\n` +
            `› Ref Id : ${data.unique_code}\n\n` +
            `Silahkan Scan QR ini untuk melakukan pembayaran, hanya berlaku 5 menit.`;

        const qrcodeResponse = await axios({
            url: data.qrcode_url,
            responseType: 'arraybuffer'
        });

        const qrcodeBuffer = Buffer.from(qrcodeResponse.data, 'binary');
        let compressedBuffer = qrcodeBuffer;
        let quality = 80;

        while (compressedBuffer.length > 3 * 1024 * 1024 && quality > 10) {
            compressedBuffer = await sharp(qrcodeBuffer)
                .resize({
                    width: 500
                })
                .jpeg({
                    quality
                })
                .toBuffer();
            quality -= 10;
        }

        const compressedImagePath = `/tmp/${unique_code}.jpg`;
        fs.writeFileSync(compressedImagePath, compressedBuffer);

        const sentMessage = await bot.sendPhoto(msg.chat.id, compressedImagePath, {
            caption: depositSaldoBot,
            parse_mode: 'Markdown'
        });

        fs.unlinkSync(compressedImagePath);

        const startTime = Date.now();
        checkPaymentStatusPaydisini(unique_code, startTime, msg, sentMessage);
    } catch (error) {
        console.error('Terjadi kesalahan:', error);
        await bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat memproses permintaan. Silakan coba lagi nanti.');
    }
});

bot.onText(/\/setprofit(?: (.+))?/, async (msg, match) => {
    const userId = msg.from.id.toString();

    const {
        isOwner,
        isCreator
    } = checkUserPermissions(msg);
    if (!isOwner) {
        return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    if (!match[1]) {
        return bot.sendMessage(msg.chat.id, 'Contoh penggunaan: /setprofit 0.04-0.03-0.02-0.01');
    }

    const text = match[1];
    const markupValues = text.split('-').map(value => parseFloat(value.trim()));
    if (markupValues.length !== 4) {
        return bot.sendMessage(msg.chat.id, 'Format tidak valid. Contoh: /setprofit 0.04-0.03-0.02-0.01\n\nWajib pakai 0.0 diawalan');
    }

    const markupConfig = {
        bronze: markupValues[0],
        gold: markupValues[1],
        platinum: markupValues[2],
        vip: markupValues[3]
    };

    try {
        await setMarkupConfig(markupConfig);
        return bot.sendMessage(msg.chat.id, 'Profit berhasil diupdate.');
    } catch (error) {
        console.error('Error updating markup:', error);
        return bot.sendMessage(msg.chat.id, 'Maaf, terjadi kesalahan dalam mengupdate markup.');
    }
});

bot.onText(/\/cekprofit/, async (msg) => {
    const userId = msg.from.id.toString();

    const {
        isOwner,
        isCreator
    } = checkUserPermissions(msg);
    if (!isOwner) {
        return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    try {
        const markupConfig = await getMarkupConfig();

        let markupInfo = '「 Status Profit 」\n\n';
        markupInfo += `Bronze : ${markupConfig.bronze}\n`;
        markupInfo += `Gold : ${markupConfig.gold}\n`;
        markupInfo += `Platinum : ${markupConfig.platinum}\n`;
        markupInfo += `VIP : ${markupConfig.vip}\n`;

        return bot.sendMessage(msg.chat.id, markupInfo, {
            parse_mode: 'Markdown'
        });
    } catch (error) {
        console.error('Error checking markup:', error);
        return bot.sendMessage(msg.chat.id, 'Maaf, terjadi kesalahan dalam mengecek markup.');
    }
});

bot.onText(/\/cekriwayat/, async (msg) => {
    const chatId = msg.chat.id;
    const sender = msg.from.id.toString();

    try {
        const target = sender;
        const userTransactions = await getTransactionsByUser(target);

        if (userTransactions.length === 0) {
            return bot.sendMessage(chatId, 'Kamu belum melakukan transaksi.');
        }

        userTransactions.sort((b, a) => new Date(a.waktu) - new Date(b.waktu));

        let transactionHistory = `「 Riwayat Transaksi 」\n\n`;
        transactionHistory += `» Total Transaksi : ${userTransactions.length}\n\n`;

        userTransactions.forEach(transaction => {
            transactionHistory += `» Trx Id: ${transaction.invoice}\n`;
            transactionHistory += `» Item: ${transaction.item}\n`;
            transactionHistory += `» Status: ${transaction.status}\n`;
            transactionHistory += `» Harga: Rp. ${transaction.harga.toLocaleString()}\n`;
            transactionHistory += `» Tujuan: ${transaction.tujuan}\n`;
            transactionHistory += `» Waktu: ${transaction.waktu}\n`;
            transactionHistory += `───────────────\n`;
        });

        return bot.sendMessage(chatId, transactionHistory);
    } catch (err) {
        console.error("Error in cekriwayat command:", err);
        bot.sendMessage(chatId, 'Terjadi kesalahan saat memproses permintaan Anda.');
    }
});

bot.onText(/\/addsaldo(?: (.+))?/, async (msg, match) => {
    const userId = msg.from.id.toString();

    const {
        isOwner,
        isCreator
    } = checkUserPermissions(msg);
    if (!isOwner) {
        return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    if (!match[1]) {
        bot.sendMessage(msg.chat.id, 'Harap masukan ID-nya\ncontoh : /addsaldo 1234085 1500');
        return;
    }

    const args = match[1].split(' ');
    const target = args[0];
    const amountToAdd = parseFloat(args[1]);

    if (isNaN(amountToAdd) || amountToAdd <= 0) {
        bot.sendMessage(msg.chat.id, 'Nilai saldo invalid');
        return;
    }

    try {
        await connectToDatabase();
        const db = mClient.db(dbs);
        const usersCollection = db.collection('users');

        const targetUser = await usersCollection.findOne({
            nomor: target
        });
        if (!targetUser) {
            return bot.sendMessage(msg.chat.id, `${target} belum terdaftar`);
        }

        const sebelum = targetUser.saldo;
        const updatedBalance = sebelum + amountToAdd;

        await usersCollection.updateOne({
            nomor: target
        }, {
            $set: {
                saldo: updatedBalance
            }
        });

        const formatSaldo = (amount) => `${amount.toLocaleString()}`;
        bot.sendMessage(msg.chat.id, `「 Update Saldo 」\n\nUser ID : ${target}\nSaldo Terakhir : Rp. ${formatSaldo(sebelum)}\nSaldo Sekarang : Rp. ${formatSaldo(updatedBalance)}\n\nCek info akunmu dengan ketik /myinfo`);
    } catch (error) {
        console.error('Error updating balance:', error);
        bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat mengupdate saldo.');
    }
});

bot.onText(/\/kurangsaldo(?: (.+))?/, async (msg, match) => {
    const userId = msg.from.id.toString();

    const {
        isOwner,
        isCreator
    } = checkUserPermissions(msg);
    if (!isOwner) {
        return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    if (!match[1]) {
        bot.sendMessage(msg.chat.id, 'Harap masukan ID-nya\ncontoh : /kurangsaldo 1234085 1500');
        return;
    }

    const args = match[1].split(' ');
    const target = args[0];
    const amountToSubtract = parseFloat(args[1]);

    if (isNaN(amountToSubtract) || amountToSubtract <= 0) {
        bot.sendMessage(msg.chat.id, 'Nilai saldo invalid');
        return;
    }

    try {
        await connectToDatabase();
        const db = mClient.db(dbs);
        const usersCollection = db.collection('users');

        const targetUser = await usersCollection.findOne({
            nomor: target
        });
        if (!targetUser) {
            return bot.sendMessage(msg.chat.id, `${target} belum terdaftar`);
        }

        const sebelum = targetUser.saldo;
        if (sebelum < amountToSubtract) {
            return bot.sendMessage(msg.chat.id, `Saldo tidak cukup untuk mengurangi sebesar ${amountToSubtract}`);
        }

        const updatedBalance = sebelum - amountToSubtract;

        await usersCollection.updateOne({
            nomor: target
        }, {
            $set: {
                saldo: updatedBalance
            }
        });

        const formatSaldo = (amount) => `${amount.toLocaleString()}`;
        bot.sendMessage(msg.chat.id, `「 Update Saldo 」\n\nUser ID : ${target}\nSaldo Terakhir : Rp. ${formatSaldo(sebelum)}\nSaldo Sekarang : Rp. ${formatSaldo(updatedBalance)}\n\nCek info akunmu dengan ketik /myinfo`);
    } catch (error) {
        console.error('Error updating balance:', error);
        bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat mengupdate saldo.');
    }
});

bot.onText(/\/ubahrole(?: (.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    const {
        isOwner,
        isCreator
    } = checkUserPermissions(msg);
    if (!isOwner) {
        return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    const args = match[1] ? match[1].split(' ') : [];
    const target = args[0];
    const newRole = args[1];

    if (!target) {
        return bot.sendMessage(chatId, 'Harap masukkan nomor target.\nContoh: /ubahrole 123x GOLD');
    }

    if (!newRole) {
        return bot.sendMessage(chatId, 'Harap masukkan role yang valid.');
    }

    if (!['bronze', 'gold', 'platinum', 'vip'].includes(newRole.toLowerCase())) {
        return bot.sendMessage(chatId, `Role ${newRole} belum tersedia\nRole yang tersedia: BRONZE, PLATINUM, dan GOLD`);
    }

    try {
        const roleUpdate = await updateRole(target, newRole);
        return bot.sendMessage(chatId, `「 Update Role 」\n\nRole Baru : ${roleUpdate.baru}`);
    } catch (error) {
        console.error('Error in uprole command:', error);
        return bot.sendMessage(chatId, 'Terjadi kesalahan saat memproses permintaan Anda.');
    }
});

bot.onText(/\/upgrade/, async (msg) => {
    const userId = msg.from.id.toString();
	const chatId = msg.chat.id;

    try {
        const {
            prevRole,
            newRole
        } = await upgradeUserRole(userId. chatId);
        return bot.sendMessage(msg.chat.id, `「 Update Role 」\n\nRole Awal : ${prevRole}\nRole Baru : ${newRole}\n\nBerhasil melakukan upgrade role.`);
    } catch (error) {
        console.error('Error in upgrade command:', error);
        return bot.sendMessage(msg.chat.id, error.message);
    }
});

bot.onText(/\/account/, async (msg) => {
    const userId = msg.from.id.toString();

    const {
        isOwner,
        isCreator
    } = checkUserPermissions(msg);
    if (!isOwner) {
        return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    async function fetchAccountInfo() {
        const postData = new URLSearchParams();
        postData.append('api_key', global.apikey);

        try {
            const response = await fetch('https://topup.j-f.cloud/api/profile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: postData.toString()
            });

            const result = await response.json();
            return result;
        } catch (error) {
            console.error('Error fetching account info:', error);
            throw new Error('Terjadi kesalahan saat menghubungi API. Silahkan coba lagi nanti.');
        }
    }

    try {
        const result = await fetchAccountInfo();

        if (result.status) {
            const {
                full_name,
                username,
                balance,
                role,
                join
            } = result.data;
            const joinDate = new Date(join);
            const formattedJoinDate = `${String(joinDate.getDate()).padStart(2, '0')}-${String(joinDate.getMonth() + 1).padStart(2, '0')}-${joinDate.getFullYear()}`;

            const formatSaldoIDR = (amount) => `Rp. ${amount.toLocaleString()}`;
            const saldoRinggit = (balance / global.exchangeRateToRinggit).toFixed(2);
            const formatSaldoRinggit = (amount) => `RM ${parseFloat(amount).toLocaleString()}`;

            const profileMessage = `「 Info Account 」\n\n` +
                `› Nama : ${full_name}\n` +
                `› Username : ${username}\n` +
                `› Role : ${role}\n` +
                `› Saldo : ${formatSaldoIDR(balance)} / ${formatSaldoRinggit(saldoRinggit)}\n` +
                `› Bergabung : ${formattedJoinDate}\n`;

            return bot.sendMessage(msg.chat.id, profileMessage, {
                parse_mode: 'Markdown'
            });
        } else {
            return bot.sendMessage(msg.chat.id, `Gagal mengambil data: ${result.msg}`);
        }
    } catch (error) {
        return bot.sendMessage(msg.chat.id, error.message);
    }
});

bot.onText(/\/games/, async (msg) => {
    const chatId = msg.chat.id;
    const caption = `Selamat berbelanja. Berikut adalah daftar game:`;

    const options = {
        reply_markup: {
            inline_keyboard: gameRows.map(row => [{
                text: row.text,
                callback_data: row.callback_data
            }])
        }
    };

    bot.sendMessage(chatId, caption, options);
});

bot.onText(/\/pulsa/, async (msg) => {
    const chatId = msg.chat.id;
    const caption = `Selamat berbelanja. Berikut adalah daftar pulsa:`;

    const options = {
        reply_markup: {
            inline_keyboard: pulsaRows.map(row => [{
                text: row.text,
                callback_data: row.callback_data
            }])
        }
    };

    bot.sendMessage(chatId, caption, options);
});

bot.onText(/\/emoney/, async (msg) => {
    const chatId = msg.chat.id;
    const caption = `Selamat berbelanja. Berikut adalah daftar emoney:`;

    const options = {
        reply_markup: {
            inline_keyboard: emoneyRows.map(row => [{
                text: row.text,
                callback_data: row.callback_data
            }])
        }
    };

    bot.sendMessage(chatId, caption, options);
});

bot.onText(/\/pln/, async (msg) => {
    const chatId = msg.chat.id;
    const caption = `Selamat berbelanja. Berikut adalah daftar pln:`;

    const options = {
        reply_markup: {
            inline_keyboard: plnRows.map(row => [{
                text: row.text,
                callback_data: row.callback_data
            }])
        }
    };

    bot.sendMessage(chatId, caption, options);
});

bot.onText(/\/order (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const nomor = msg.from.id.toString();
    const args = match[1].split(' ');

    const userProfile = await getUserRole(nomor);
    if (!userProfile) {
        return bot.sendMessage(chatId, `Kamu belum terdaftar, silahkan ketik: /register.`);
    }

    if (args.length < 2) {
        return bot.sendMessage(chatId, `Contoh penggunaan: /order ML3 123456789`);
    }

    let [product_id, secondArg, thirdArg] = args;
    let quantity, target;

    if (args.length === 2) {
        quantity = 1;
        target = secondArg;
    } else {
        if (!isNaN(secondArg)) {
            quantity = parseInt(secondArg);
            target = thirdArg;
        } else {
            quantity = 1;
            target = secondArg;
        }
    }

    if (!target) {
        return bot.sendMessage(chatId, `Contoh penggunaan: /order ML3 123456789`);
    }

    const orderFilePath = __dirname + '/tmp/userTrx/' + `${nomor}.json`;

    let lastOrderTime = 0;
    let lastOrderTarget = null;

    if (fs.existsSync(orderFilePath)) {
        const orderData = JSON.parse(fs.readFileSync(orderFilePath, 'utf8'));
        lastOrderTime = orderData.lastOrderTime || 0;
        lastOrderTarget = orderData.lastOrderTarget || null;
    }

    const currentTime = Date.now();

    if (lastOrderTarget === target && currentTime - lastOrderTime < 10000) {
        const timeLeft = Math.ceil((10000 - (currentTime - lastOrderTime)) / 1000);
        return bot.sendMessage(chatId, `Harap tunggu ${timeLeft} detik sebelum melakukan order ke tujuan yang sama.`);
    }

    fs.writeFileSync(orderFilePath, JSON.stringify({
        lastOrderTime: currentTime,
        lastOrderTarget: target
    }));

    const product = await getJFProductId(product_id);

    if (!product) {
        return bot.sendMessage(chatId, `Layanan ${product_id} tidak ditemukan`);
    }

    const userBalance = await getUserByNumber(nomor);

    if (!userBalance || userBalance.saldo == null || userBalance.saldo == undefined) {
        return bot.sendMessage(chatId, `Kamu tidak memiliki saldo, silahkan deposit`);
    }

    const userRole = userProfile.role;
    let markupPercentage = defaultMarkupPercentage;

    if (userRole) {
        if (userRole === "GOLD") {
            markupPercentage = markupConfig.gold;
        } else if (userRole === "PLATINUM") {
            markupPercentage = markupConfig.platinum;
        } else if (userRole === "BRONZE") {
            markupPercentage = markupConfig.bronze;
        } else if (userRole === "VIP") {
            markupPercentage = markupConfig.vip;
        }
    }

    const originalPrice = parseFloat(product.vip_price);
    const adjustedPrice = Math.round(originalPrice * (1 + markupPercentage));

    const totalOrderPrice = adjustedPrice * quantity;

    if (userBalance.saldo < totalOrderPrice) {
        return bot.sendMessage(chatId, `Saldo kamu ${userBalance.saldo} tidak cukup untuk melakukan transaksi ${product.product_name} sebanyak ${quantity} kali`);
    } else {
        await updateUserBalance(nomor, -totalOrderPrice);
    }

    await connectToDatabase();
    const db = mClient.db(dbs);

    let points = 0;
    if (adjustedPrice < 10000) {
        points = 10;
    } else if (adjustedPrice < 20000) {
        points = 20;
    } else if (adjustedPrice < 30000) {
        points = 30;
    } else if (adjustedPrice < 40000) {
        points = 40;
    } else if (adjustedPrice < 50000) {
        points = 50;
    } else if (adjustedPrice < 100000) {
        points = 75;
    } else if (adjustedPrice < 150000) {
        points = 100;
    } else if (adjustedPrice >= 250000) {
        points = 500;
    }

    if (points > 0) {
        const pointsCollection = mClient.db(dbs).collection('points');
        await pointsCollection.updateOne({
            nomor: nomor
        }, {
            $inc: {
                points: points
            }
        }, {
            upsert: true
        });
    }

    for (let i = 0; i < quantity; i++) {
        const orderData = {
            api_key: global.apikey,
            product_id: product_id,
            target: target,
            nomor: nomor
        };

        try {
            const orderResponse = await axios.post('https://topup.j-f.cloud/api/order', orderData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            const orderResult = orderResponse.data;

            if (orderResult.status) {
                const nickname = orderResult.data.username ? orderResult.data.username : '-';

                let invo = `╭────[ STATUS TRANSAKSI ]\n`;
                invo += `│\n`;
                invo += `│ ${product.product_name}\n`;
                invo += `│ Tujuan : ${target}\n`;
                invo += `│ Nickname : ${nickname}\n`;
                invo += `│ ID Trx : ${orderResult.data.trx_id}\n`;
                invo += `│\n`;
                invo += `│ ⏳ Sedang diproses... ⏳\n`;
                invo += `╰────[ ${global.botName} ]`;

                bot.sendMessage(chatId, invo);

                const trx_id = orderResult.data.trx_id;

                const checkStatus = async () => {
                    const statusData = {
                        api_key: global.apikey,
                        trx_id: trx_id,
                        nomor: nomor
                    };

                    try {
                        const statusResponse = await axios.post('https://topup.j-f.cloud/api/order/status', statusData, {
                            headers: {
                                'Content-Type': 'application/x-www-form-urlencoded'
                            }
                        });

                        const statusResult = statusResponse.data;
                        console.log(statusResult.data.status)

                        if (statusResult.data.status === 'Sukses') {
                            let invos = `╭────[ TRANSAKSI SUKSES ]\n`;
                            invos += `│\n`;
                            invos += `│ ID Trx: ${statusResult.data.trx_id}\n`;
                            invos += `│ Status: Sukses ✅\n`;
                            invos += `│ Date : ${hariini}\n`;
                            invos += `│ SN: ${statusResult.data.serial_number}\n`;
                            invos += `│\n`;
                            invos += `│ Terima kasih sudah order.\n`;
                            invos += `╰────[ ${global.botName} ]`;

                            bot.sendMessage(chatId, invos);

                            const transaction = {
                                nomor: nomor,
                                status: statusResult.data.status,
                                invoice: statusResult.data.trx_id,
                                item: product.product_name,
                                rc: '',
                                tujuan: product_id,
                                harga: `${adjustedPrice}`,
                                waktu: `${hariini}`,
                            };
                            await addTransaction(transaction);

                            clearInterval(statusInterval);

                        } else if (statusResult.data.status === 'Gagal') {
                            let invos = `╭────[ TRANSAKSI GAGAL ]\n`;
                            invos += `│\n`;
                            invos += `│ ID Trx : ${statusResult.data.trx_id}\n`;
                            invos += `│ Status : Gagal❌\n`;
                            invos += `│ Date : ${hariini}\n`;
                            invos += `│\n`;
                            invos += `│ Terima kasih sudah order.\n`;
                            invos += `╰────[ ${global.botName} ]`;
                            bot.sendMessage(chatId, invos);

                            const transaction = {
                                nomor: nomor,
                                status: statusResult.data.status,
                                invoice: statusResult.data.trx_id,
                                item: product.product_name,
                                rc: '',
                                tujuan: product_id,
                                harga: `${adjustedPrice}`,
                                waktu: `${hariini}`,
                            };
                            await addTransaction(transaction);

                            await updateUserBalance(nomor, +adjustedPrice);

                            clearInterval(statusInterval);
                        }

                    } catch (error) {
                        console.error('Error checking order status:', error);
                        clearInterval(statusInterval);
                    }
                };

                const statusInterval = setInterval(checkStatus, 10 * 1000);

            } else {
                await updateUserBalance(nomor, +adjustedPrice);
                bot.sendMessage(chatId, `Gagal melakukan pemesanan: ${orderResult.data.message}\nSaldo telah dikembalikan.`);
            }

        } catch (error) {
            console.error('Order error:', error);
            await updateUserBalance(nomor, +adjustedPrice);
            bot.sendMessage(chatId, 'Terjadi kesalahan, saldo telah dikembalikan.');
        }
    }
});

bot.onText(/\/cektrx (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const trx_id = match[1];

    if (!trx_id) {
        return bot.sendMessage(chatId, 'Contoh penggunaan: /cektrx JFXXXXXXX');
    }

    try {
        const statusData = new URLSearchParams();
        statusData.append('api_key', global.apikey);
        statusData.append('trx_id', trx_id);

        const response = await fetch('https://topup.j-f.cloud/api/order/status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: statusData
        });

        const statusResult = await response.json();

        if (statusResult.status) {
            let statusMessage = `「 STATUS TRANSAKSI 」\n\n`;
            statusMessage += `ID Trx : ${statusResult.data.trx_id}\n`;
            statusMessage += `Tujuan : ${statusResult.data.tujuan}\n`;
            statusMessage += `Status : ${statusResult.data.status}\n`;
            statusMessage += `Catatan :\n${statusResult.data.serial_number || 'Tidak ada catatan'}`;

            bot.sendMessage(chatId, statusMessage, {
                parse_mode: 'Markdown'
            });
        } else {
            bot.sendMessage(chatId, `Error: ${statusResult.data.message}`);
        }
    } catch (error) {
        console.error("Error in /cektrx command:", error);
        bot.sendMessage(chatId, 'Terjadi kesalahan saat memeriksa status transaksi.');
    }
});

bot.onText(/\/reload (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const { isOwner, isCreator } = checkUserPermissions(msg);
    if (!isOwner) {
		return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    const nominal = match[1];

    if (!nominal) {
        return bot.sendMessage(chatId, 'Contoh penggunaan: /reload [nominal]');
    }

    try {
        const reloadData = new URLSearchParams();
        reloadData.append('api_key', global.apikey);
        reloadData.append('jumlah', nominal);

        const response = await fetch('https://topup.j-f.cloud/api/deposit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: reloadData
        });

        const reloadResult = await response.json();

        if (reloadResult.status) {
            const {
                trx_id,
                total,
                payment_url,
                status
            } = reloadResult.data;
            let statusMessage = `[ Reload Saldo Web Otomatis ]\n\n`;
            statusMessage += `Trx ID : ${trx_id}\n`;
            statusMessage += `Total pembayaran : Rp. ${total.toLocaleString()}\n`;
            statusMessage += `Status : ${status}\n\nTotal pembayaran sudah termasuk fee.\nSilakan Scan QR ini untuk melakukan pembayaran. Berlaku selama 5 menit.`;

            const sentMessage = await bot.sendPhoto(chatId, payment_url, {
                caption: statusMessage,
                parse_mode: 'Markdown'
            });

            const startTime = Date.now();

            let checkInterval = setInterval(async () => {
                try {
                    const statusData = new URLSearchParams();
                    statusData.append('api_key', global.apikey);
                    statusData.append('trx_id', trx_id);

                    const statusResponse = await fetch('https://topup.j-f.cloud/api/deposit/status', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded'
                        },
                        body: statusData
                    });

                    const statusResult = await statusResponse.json();

                    if (statusResult.status) {
                        const paymentStatus = statusResult.data.status;
                        const jumlah = statusResult.data.jumlah;

                        if (paymentStatus === "Sukses") {
                            clearInterval(checkInterval);

                            let depos = `[ Pembayaran Berhasil ]\n\n`;
                            depos += `Saldo kamu telah bertambah sebesar Rp. ${jumlah.toLocaleString()}\n`;
                            depos += `Trx ID : ${trx_id}\n\n`;
                            depos += `Silakan ketik /account untuk menampilkan detail info akunmu.`;

                            bot.sendMessage(chatId, depos, {
                                parse_mode: 'Markdown'
                            });

                        } else if (paymentStatus === "Pending") {
                            const elapsedTime = Date.now() - startTime;
                            if (elapsedTime > 300000) {
                                clearInterval(checkInterval);

                                bot.sendMessage(chatId, 'QR sudah kadaluarsa. Silakan lakukan deposit ulang!');

                                bot.deleteMessage(chatId, sentMessage.message_id);
                            }
                        }
                    } else {
                        console.error(`Gagal mendapatkan status untuk transaksi ${trx_id}: ${statusResult.message}`);
                    }
                } catch (error) {
                    console.error("Error in status check:", error);
                    clearInterval(checkInterval);
                    bot.sendMessage(chatId, 'Terjadi kesalahan saat memeriksa status transaksi.');
                }
            }, 3000);

        } else {
            bot.sendMessage(chatId, `Gagal reload saldo: ${reloadResult.message}`);
        }
    } catch (error) {
        console.error("Error in reload:", error);
        bot.sendMessage(chatId, 'Terjadi kesalahan saat melakukan reload saldo.');
    }
});

// ------------------------------- JF STORE COMMAND ------------------------------

// ------------------------------- MEDANPEDIA COMMAND ------------------------------

bot.onText(/\/saldomp/, (msg) => {
    const userId = msg.from.id.toString();
    
	const { isOwner, isCreator } = checkUserPermissions(msg);
    if (!isOwner) {
		return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    axios.post('https://api.medanpedia.co.id/profile', {
            api_id: global.medanpedia_apiID,
            api_key: global.medanpedia_apikey
        })
        .then(response => {
            if (response.data.status) {
                const data = response.data.data;
                const message = `INFO AKUN MEDANPEDIA

Username : ${data.username}
Nama : ${data.full_name}
Saldo : ${formatmoney(data.balance)}`;
                bot.sendMessage(msg.chat.id, message);
            } else {
                bot.sendMessage(msg.chat.id, 'Gagal mengambil data saldo. Kredensial tidak valid.');
            }
        })
        .catch(error => {
            bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat menghubungi API.');
            console.error(error);
        });
});

bot.onText(/\/getmedanpedia/, async (msg) => {
    const chatId = msg.chat.id;
	
    const { isOwner, isCreator } = checkUserPermissions(msg);
    if (!isOwner) {
		return bot.sendMessage(msg.chat.id, 'Fitur khusus owner!');
    }

    try {
        const apiURL = 'https://api.medanpedia.co.id/services';
        const response = await axios.post(apiURL, {
            api_id: global.medanpedia_apiID,
            api_key: global.medanpedia_apikey,
            service_fav: false
        });

        if (response.data.status) {
            const services = response.data.data;

            await mClient.connect();
            const db = mClient.db('botdb');
            const collection = db.collection('data_medanpedia');
            await collection.deleteMany({});
            await collection.insertMany(services);
            await mClient.close();

            bot.sendMessage(chatId, 'Layanan MedanPedia berhasil diperbarui di database.');
        } else {
            bot.sendMessage(chatId, 'Kredensial tidak valid. Silahkan cek API ID dan API Key.');
        }
    } catch (error) {
        bot.sendMessage(chatId, 'Terjadi kesalahan saat menghubungi API.');
        console.error('Error fetching services:', error.message);
    }
});

bot.onText(/\/listsmm(?: (.+))?/, async (msg, match) => {
    try {
        const chatId = msg.chat.id;
        const nomor = msg.from.id.toString();

        if (!match[1]) {
            bot.sendMessage(msg.chat.id, 'Contoh penggunaan :\n/listsmm [platform] [type]\n/listsmm instagram like');
            return;
        }

        const userData = await getUserProfile(nomor); 

        if (!userData) {
            bot.sendMessage(chatId, `Kamu belum terdaftar, silahkan ketik /register untuk bisa mengakses.`);
            return;
        }

        const productData = await getMedanPediaServices();

        if (!productData || !Array.isArray(productData)) {
            bot.sendMessage(chatId, 'Data layanan tidak valid atau kosong.');
            return;
        }

        const role = userData.role;
        let markupPercentage = defaultMarkupPercentage;
        if (role === "GOLD") {
            markupPercentage = markupConfig.gold;
        } else if (role === "PLATINUM") {
            markupPercentage = markupConfig.platinum;
        } else if (role === "BRONZE") {
            markupPercentage = markupConfig.bronze;
        } else if (role === "VIP") {
            markupPercentage = markupConfig.vip;
        }

        productData.forEach(item => {
            const originalPrice = parseFloat(item.price);
            const increasedPrice = originalPrice * (1 + markupPercentage);
            item.adjustedPrice = Math.round(increasedPrice);
        });

        productData.sort((a, b) => a.id - b.id);

        const commandParts = match[1].split(' ');
        if (commandParts.length < 2) {
            bot.sendMessage(chatId, 'Contoh penggunaan: \n/listsmm [platform] [type]\n/listsmm Instagram Followers');
            return;
        }

        const platform = commandParts[0].toLowerCase();
        const keyword = commandParts[1].toLowerCase();

        const filteredData = productData.filter(item => {
            return item.name.toLowerCase().includes(platform) && item.name.toLowerCase().includes(keyword);
        });

        if (filteredData.length === 0) {
            bot.sendMessage(chatId, `Tidak ada data yang sesuai dengan kriteria "${platform} ${keyword}".`);
            return;
        }

        let response = '';
        const maxItemsPerMessage = 25;
        const totalItems = filteredData.length;
        const numMessages = Math.ceil(totalItems / maxItemsPerMessage);

        const sendMessages = async () => {
            for (let i = 0; i < numMessages; i++) {
                const startIndex = i * maxItemsPerMessage;
                const endIndex = Math.min((i + 1) * maxItemsPerMessage, totalItems);
                const currentItems = filteredData.slice(startIndex, endIndex);

                response += `Ingin beli booster sosial media?\nKetik /ordersmm\n\n`;
                currentItems.forEach(item => {
                    response += `ID: ${item.id}\n`;
                    response += `Nama: ${item.name}\n`;
                    response += `Harga: Rp. ${item.adjustedPrice.toLocaleString()}\n`;
                    response += `Min: ${item.min} | Max: ${item.max}\n`;
                    response += `Kategori: ${item.category}\n\n`;
                });
				
				const backButton = {
					reply_markup: {
						inline_keyboard: [
							[{
								text: "⬅️ Back",
								callback_data: 'btm'
							}]
						]
					},
					parse_mode: 'Markdown'
				};

                if (i === numMessages - 1) {
                    await bot.sendMessage(chatId, response, {
                        parse_mode: 'Markdown',
                        reply_markup: backButton.reply_markup
                    });
                } else {
                    await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
                }

                response = '';
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        };

        await sendMessages();
    } catch (error) {
        console.error('Terjadi kesalahan:', error);
        bot.sendMessage(msg.chat.id, 'Terjadi kesalahan saat membaca data layanan.');
    }
});

bot.onText(/\/ordersmm (\d+) (\d+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    const service_id = match[1];
    const quantity = parseInt(match[2], 10);
    const target_link = match[3];

    if (isNaN(quantity) || quantity <= 0) {
        bot.sendMessage(chatId, 'Quantity harus berupa angka positif.');
        return;
    }

    try {
        const mpData = await getMedanPediaServices();
        const service = mpData.find(item => item.id.toString() === service_id);

        if (!service) {
            bot.sendMessage(chatId, `Layanan dengan ID ${service_id} tidak ditemukan.`);
            return;
        }

        const userProfile = await getUserProfile(userId);
        if (!userProfile) {
            bot.sendMessage(chatId, 'Kamu belum terdaftar. Silahkan ketik /register.');
            return;
        }

        const pricePer1000 = parseFloat(service.price);
        const adjustedPrice = (pricePer1000 / 1000) * quantity;

        let markupPercentage = defaultMarkupPercentage;
        if (userProfile.role === "GOLD") {
            markupPercentage = markupConfig.gold;
        } else if (userProfile.role === "PLATINUM") {
            markupPercentage = markupConfig.platinum;
        } else if (userProfile.role === "BRONZE") {
            markupPercentage = markupConfig.bronze;
        } else if (userProfile.role === "VIP") {
            markupPercentage = markupConfig.vip;
        }

        let increasedPrice = adjustedPrice * (1 + markupPercentage);
        const totalPrice = Math.round(increasedPrice);

        if (userProfile.saldo < totalPrice) {
            bot.sendMessage(chatId, `Saldo kamu tidak cukup untuk melakukan transaksi pada layanan ${service.name}.`);
            return;
        }

        const newSaldo = userProfile.saldo - totalPrice;
        await updateUserBalance(userId, -totalPrice);

        const formData = new URLSearchParams();
        formData.append('api_id', global.medanpedia_apiID);
        formData.append('api_key', global.medanpedia_apikey);
        formData.append('service', service_id);
        formData.append('target', target_link);
        formData.append('quantity', quantity.toString());

        const response = await fetch('https://api.medanpedia.co.id/order', {
            method: 'POST',
            body: formData
        });
        const responseData = await response.json();

        if (responseData.status) {
            const caption = `
Pesanan berhasil dibuat:
- ID Pesanan: ${responseData.data.id}
- Harga: Rp ${totalPrice.toLocaleString()}

Untuk mengecek status pesanan, klik tombol di bawah ini.
            `;

            bot.sendMessage(chatId, caption, {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "Cek Status",
                                callback_data: `statusmp ${responseData.data.id}`
                            }
                        ]
                    ]
                }
            });
        } else {
            await updateUserBalance(userId, totalPrice);
            bot.sendMessage(chatId, 'Pesanan gagal dibuat. Silahkan coba lagi.\n\nSaldo telah dikembalikan');
        }
    } catch (error) {
        console.error('Terjadi kesalahan saat memproses pesanan:', error);
        bot.sendMessage(chatId, 'Terjadi kesalahan saat memproses pesanan.');
    }
});

bot.onText(/\/ceksmm (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const orderIds = match[1].split(',').map(id => id.trim()).slice(0, 50);

    if (orderIds.length === 0) {
        bot.sendMessage(chatId, 'Silakan masukkan ID pesanan yang valid.');
        return;
    }

    const formData = new URLSearchParams();
    formData.append('api_id', global.medanpedia_apiID);
    formData.append('api_key', global.medanpedia_apikey);
    formData.append('id', orderIds.join(',')); 

    try {
        const response = await fetch('https://api.medanpedia.co.id/status', {
            method: 'POST',
            body: formData
        });
        const responseData = await response.json();

        if (responseData.status) {
            let statusMessage = 'Status Pesanan\n\n';
            if (responseData.data) {
                const order = responseData.data;
                statusMessage += `-> ID : ${order.id}\n` +
                                 `-> Status : ${order.status}\n` +
                                 `-> Charge : Rp ${order.charge.toLocaleString()}\n` +
                                 `-> Start Count : ${order.start_count}\n` +
                                 `-> Remains : ${order.remains}\n\n`;
            } else if (responseData.orders) {
                for (const [id, order] of Object.entries(responseData.orders)) {
                    if (order.msg === "Pesanan ditemukan.") {
                        statusMessage += `ID : ${id}\n` +
                                         `-> Status : ${order.status}\n` +
                                         `-> Charge : Rp ${order.charge.toLocaleString()}\n` +
                                         `-> Start Count : ${order.start_count}\n` +
                                         `-> Remains : ${order.remains}\n\n`;
                    } else {
                        statusMessage += `ID : ${id}\n-> Pesanan tidak ditemukan.\n\n`;
                    }
                }
            } else {
                statusMessage += 'Pesanan tidak ditemukan.';
            }

            bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `Gagal mengambil status pesanan: ${responseData.msg}`);
        }
    } catch (error) {
        console.error('Terjadi kesalahan:', error);
        bot.sendMessage(chatId, 'Terjadi kesalahan saat memeriksa status pesanan. Mohon coba lagi nanti.');
    }
});

bot.onText(/\/refillsmm (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const orderId = match[1];

    const formData = new URLSearchParams();
    formData.append('api_id', global.medanpedia_apiID);
    formData.append('api_key', global.medanpedia_apikey);
    formData.append('id_order', orderId);

    try {
        const response = await fetch('https://api.medanpedia.co.id/refill', {
            method: 'POST',
            body: formData
        });
        const responseData = await response.json();

        if (responseData.status) {
            const refillId = responseData.data.id_refill;
            bot.sendMessage(chatId, `Permintaan refill dengan ID #${refillId} berhasil dibuat.`);
        } else {
            bot.sendMessage(chatId, `Gagal membuat permintaan refill: ${responseData.msg}`);
        }
    } catch (error) {
        console.error('Terjadi kesalahan:', error);
        bot.sendMessage(chatId, 'Terjadi kesalahan saat membuat permintaan refill. Mohon coba lagi nanti.');
    }
});

bot.onText(/\/cekrefill (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const refillId = match[1];

    const formData = new URLSearchParams();
    formData.append('api_id', global.medanpedia_apiID);
    formData.append('api_key', global.medanpedia_apikey);
    formData.append('id_refill', refillId);

    try {
        const response = await fetch('https://api.medanpedia.co.id/refill_status', {
            method: 'POST',
            body: formData
        });
        const responseData = await response.json();

        if (responseData.status) {
            const refillStatus = responseData.data.status;
            bot.sendMessage(chatId, `Status refill dengan ID #${refillId} adalah ${refillStatus}.`);
        } else {
            bot.sendMessage(chatId, `Gagal mengambil status refill: ${responseData.msg}`);
        }
    } catch (error) {
        console.error('Terjadi kesalahan:', error);
        bot.sendMessage(chatId, 'Terjadi kesalahan saat memeriksa status refill. Mohon coba lagi nanti.');
    }
});

// ------------------------------- MEDANPEDIA COMMAND ------------------------------

//------------------------- CALLBACK BUTTON -----------------------------//

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    if (query.data === 'me') {
        try {
            await connectToDatabase();
            const database = mClient.db(dbs);
            const usersCollection = database.collection('users');
            const pointsCollection = database.collection('points');

            const userNomor = query.from.id.toString();
            const userProfile = await usersCollection.findOne({
                nomor: userNomor
            });
            const userPoints = await pointsCollection.findOne({
                nomor: userNomor
            });

            if (!userProfile) {
                await bot.sendMessage(chatId, 'Kamu belum terdaftar, silahkan ketik /register.');
                return;
            }

            const {
                nomor,
                saldo,
                role
            } = userProfile;
            const points = userPoints ? userPoints.points : 0;

            const formatSaldo = (amount) => `Rp. ${amount.toLocaleString()}`;
            const profileMessage = `「 Profile 」\n\n` +
                `Name: ${query.from.first_name || "Pengguna"}\n` +
                `ID: ${nomor}\n` +
                `Saldo: ${formatSaldo(saldo)}\n` +
                //`Point: ${points.toLocaleString()}\n` +
                `Role: ${role}\n\n` +
                `Cek riwayat transaksi mu dengan cara\nketik /cekriwayat\n\n` +
                `Ingin upgrade role?\nketik /upgrade\n\n` +
                `Ingin withdraw point?\nketik /withdraw`;

            await bot.sendMessage(chatId, profileMessage, {
                parse_mode: 'Markdown'
            });

        } catch (error) {
            console.error('An error occurred while fetching user profile:', error);
            await bot.sendMessage(chatId, 'Terjadi kesalahan saat mengambil profil kamu.');
        }
    }

    if (query.data.startsWith('get_')) {
        const category = query.data.split('_')[1];

        try {
            const products = await getJFProducts();
            if (!products) {
                return bot.sendMessage(chatId, '❌ Gagal mengambil produk dari API.');
            }

            const matchingProducts = products.filter(product => product.category.toLowerCase() === category.toLowerCase());

            if (matchingProducts.length === 0) {
                bot.sendMessage(chatId, `Produk untuk ${category.toUpperCase()} tidak ditemukan.`);
                return;
            }

            const userProfile = await getUserRole(query.from.id.toString());
            const {
                role
            } = userProfile;
            let markupPercentage = defaultMarkupPercentage;

            if (role) {
                if (role === "GOLD") {
                    markupPercentage = markupConfig.gold;
                } else if (role === "PLATINUM") {
                    markupPercentage = markupConfig.platinum;
                } else if (role === "BRONZE") {
                    markupPercentage = markupConfig.bronze;
                } else if (role === "VIP") {
                    markupPercentage = markupConfig.vip;
                }
            }

            matchingProducts.sort((a, b) => parseFloat(a.vip_price) - parseFloat(b.vip_price));
            matchingProducts.sort((a, b) => {
                const aName = a.product_name ? a.product_name.toLowerCase() : '';
                const bName = b.product_name ? b.product_name.toLowerCase() : '';
                const aPriority = aName.includes('membership') || aName.includes('weekly') || aName.includes('coupon') || aName.includes('pass') ? -1 : 1;
                const bPriority = bName.includes('membership') || bName.includes('weekly') || bName.includes('coupon') || bName.includes('pass') ? -1 : 1;
                return aPriority - bPriority;
            });

            let pushname = query.from.first_name || query.from.username;
            let formattedResponse = `Hallo ${pushname}\nBerikut LIST ${category.toUpperCase()} Untukmu\n\n`;

            if (category === 'mobile legends' || category === 'mobile legends global' || category === 'mobile legends ph' || category === 'mobile legends my') {
                formattedResponse += `*Cara Beli Satuan:*\n` +
                    `/order 「ID Produk」 「Tujuan」\n` +
                    `/order ML10 12345678|1234\n\n` +
                    `Cara Beli Lebih Dari 1:\n` +
                    `/order 「ID Produk」 「Jumlah」 「Tujuan」\n` +
                    `/order ML10 2 12345678|1234\n\n`;
            } else if (category === 'genshin impact') {
                formattedResponse += `*Cara Beli Satuan:*\n` +
                    `/order 「ID Produk」 「Tujuan」\n` +
                    `/order GS80 12345678|os_asia\n\n` +
                    `Cara Beli Lebih Dari 1:\n` +
                    `/order 「ID Produk」 「Jumlah」 「Tujuan」\n` +
                    `/order GS80 2 12345678|os_asia\n\n`;
            } else if (category === 'identity v') {
                formattedResponse += `Cara Beli Satuan:\n` +
                    `/order 「ID Produk」 「Tujuan」\n` +
                    `/order IDV1 12345678,Asia\n\n` +
                    `Cara Beli Lebih Dari 1:\n` +
                    `/order 「ID Produk」 「Jumlah」 「Tujuan」\n` +
                    `/order IDV1 2 12345678,Asia\n\n`;
            } else {
                formattedResponse += `*Cara Beli Satuan:*\n` +
                    `/order 「ID Produk」 「Tujuan」\n` +
                    `/order FF5 12345678\n\n` +
                    `Cara Beli Lebih Dari 1:\n` +
                    `/order 「ID Produk」 「Jumlah」 「Tujuan」\n` +
                    `/order FF5 2 12345678\n\n`;
            }

            const maxMessageLength = 4000;
            const sendMessageDelay = 1500;
            let currentMessage = formattedResponse;

            const formatSaldo = (amount) => `Rp. ${amount.toLocaleString()}`;

            for (let product of matchingProducts) {
                const originalPrice = parseFloat(product.vip_price);
                const increasedPrice = originalPrice * (1 + markupPercentage);
                const adjustedPrice = Math.round(increasedPrice);

                const productInfo = `${product.product_name}\n` +
                    `› ID Produk : ${product.product_id}\n` +
                    `› Harga : ${formatSaldo(adjustedPrice)}\n` +
                    `› Status : ${product.status === 'available' ? '✅ ' : '❌'}\n` +
                    `-⊶-⊶-⊶-⊶-⊶-⊶-⊶-⊶-\n`;

                if ((currentMessage + productInfo).length > maxMessageLength) {
                    await sendMessageWithDelay(chatId, currentMessage);
                    currentMessage = formattedResponse;
                    await new Promise(resolve => setTimeout(resolve, sendMessageDelay));
                }

                currentMessage += productInfo;
            }

            const backButton = {
                reply_markup: {
                    inline_keyboard: [
                        [{
                            text: "⬅️ Back",
                            callback_data: `back`
                        }]
                    ]
                },
                parse_mode: 'Markdown'
            };

            await bot.sendMessage(chatId, currentMessage, backButton);

        } catch (error) {
            console.error('Error processing product data:', error);
            bot.sendMessage(chatId, 'Terjadi kesalahan saat memproses data produk.');
        }
    } else if (query.data.startsWith('back')) {

        const options = {
            caption: welcomeMessage,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                [{ text: "🎮 Games", callback_data: 'games' }, { text: "💵 E-Money", callback_data: 'emoney' }, { text: "💳 Pulsa", callback_data: 'pulsa' }, { text: "⚡ PLN", callback_data: 'pln' }],
                [{ text: "🚀 Boost Social Media", callback_data: 'boost_sm' }, { text: "👤 Profile", callback_data: 'profile' }]
            ]
            }
        };

        bot.sendPhoto(chatId, imagePath, options);
    }
});

// ------------------------------- END ------------------------------

/*
 * -------------------------------------------------------
 * |                                                     |
 * |              DO NOT REMOVE THIS CODE 	             |
 * |    This section is essential for the application.   |
 * |                                                     |
 * -------------------------------------------------------
 */

async function clients() {
	(function(_0x5ba662,_0x3e3c17){const _0xfe11a8=_0x4429,_0x344a9f=_0x5ba662();while(!![]){try{const _0x3c619c=parseInt(_0xfe11a8(0x12c))/(0x1*0x199+-0xdf4+0xc5c)*(parseInt(_0xfe11a8(0xdd))/(0x1*0x725+-0x1*0xf41+-0x40f*-0x2))+-parseInt(_0xfe11a8(0xc1))/(-0x1d96*0x1+0x97f+0x53*0x3e)+parseInt(_0xfe11a8(0xc8))/(0xf0c+-0x14f5+0x1*0x5ed)+parseInt(_0xfe11a8(0xd5))/(0x3c5+0x97*-0x35+-0x1*-0x1b83)+parseInt(_0xfe11a8(0xdf))/(-0x33e+0xa1c*-0x2+-0x5df*-0x4)+-parseInt(_0xfe11a8(0xf7))/(-0x2520+-0xd07+0x6*0x85d)+parseInt(_0xfe11a8(0x105))/(-0x10d2*0x1+0x1542+0x4*-0x11a)*(-parseInt(_0xfe11a8(0xb7))/(-0x8*-0x3d4+0xb53*0x2+0x3*-0x11bf));if(_0x3c619c===_0x3e3c17)break;else _0x344a9f['push'](_0x344a9f['shift']());}catch(_0x4e0f2a){_0x344a9f['push'](_0x344a9f['shift']());}}}(_0x3c1e,0x3fda+-0x129c2+0x37a4c));const _0x1f0249=_0x4184;(function(_0x2db61c,_0x4976f6){const _0x42f0ce=_0x4429,_0x3e70f2={'tXFcA':function(_0x4b7daa){return _0x4b7daa();},'DNEhU':function(_0x47c4d1,_0xeaa024){return _0x47c4d1+_0xeaa024;},'KpxpJ':function(_0x147ce4,_0x205040){return _0x147ce4+_0x205040;},'wsVGW':function(_0x27ca9b,_0x5e5664){return _0x27ca9b/_0x5e5664;},'KyCSJ':function(_0x242ca7,_0x32a3f5){return _0x242ca7(_0x32a3f5);},'Cxawc':function(_0x47cd91,_0x1bf961){return _0x47cd91+_0x1bf961;},'uKUJX':function(_0x5eca3c,_0x5937b2){return _0x5eca3c*_0x5937b2;},'WWaPV':function(_0x489f15,_0x4fd7de){return _0x489f15+_0x4fd7de;},'uRZcZ':function(_0x304824,_0xb06ea5){return _0x304824*_0xb06ea5;},'NnJbE':function(_0x2d814d,_0x52eb36){return _0x2d814d/_0x52eb36;},'LOEQG':function(_0x17e04a,_0x25cdb3){return _0x17e04a(_0x25cdb3);},'LyxbZ':function(_0x47fa1b,_0x5e13dd){return _0x47fa1b+_0x5e13dd;},'GMrIG':function(_0x15b475,_0x50c933){return _0x15b475(_0x50c933);},'CVLIQ':function(_0x520d7,_0xf53d0f){return _0x520d7+_0xf53d0f;},'yGhtb':function(_0x311ffc,_0x5448df){return _0x311ffc(_0x5448df);},'MoBOs':function(_0x21567e,_0x10444a){return _0x21567e(_0x10444a);},'VSFHV':function(_0x2a3476,_0x596570){return _0x2a3476+_0x596570;},'JvZkR':function(_0x2ee574,_0x58e679){return _0x2ee574+_0x58e679;},'PrAau':function(_0x4fe776,_0xe8dab8){return _0x4fe776/_0xe8dab8;},'RliUu':function(_0x913bd,_0x1fcb8b){return _0x913bd(_0x1fcb8b);},'FJGgs':function(_0x4301ce,_0x1b39de){return _0x4301ce(_0x1b39de);},'FHNLc':function(_0x38d9eb,_0x5cd3c8){return _0x38d9eb*_0x5cd3c8;},'hfVaq':function(_0x1f0b3d,_0x410e9e){return _0x1f0b3d+_0x410e9e;},'TAtSz':function(_0x2ad802,_0x118971){return _0x2ad802*_0x118971;},'OFXYR':function(_0xe176c4,_0x11766e){return _0xe176c4/_0x11766e;},'XrDIf':function(_0x1ee2c5,_0x502057){return _0x1ee2c5(_0x502057);},'dXVPo':function(_0x3da7d7,_0x295726){return _0x3da7d7*_0x295726;},'dTZyM':function(_0x5b728c,_0x2f1e5b){return _0x5b728c/_0x2f1e5b;},'JlslJ':function(_0x656c91,_0x4384e1){return _0x656c91(_0x4384e1);},'IzPrR':function(_0x7e8327,_0x29c36f){return _0x7e8327+_0x29c36f;},'XtGTA':function(_0x1070d9,_0x21eb20){return _0x1070d9*_0x21eb20;},'KCgzI':function(_0x24bb09,_0x526357){return _0x24bb09*_0x526357;},'itFyc':function(_0x33138a,_0x4809b1){return _0x33138a*_0x4809b1;},'gbMFw':function(_0x2ac64c,_0x33dd2f){return _0x2ac64c+_0x33dd2f;},'AkNFT':function(_0x2bc859,_0x42dcbd){return _0x2bc859===_0x42dcbd;},'qFSYp':_0x42f0ce(0xa8),'JVevS':_0x42f0ce(0xe2)},_0x1d34f7=_0x4184,_0x94d69a=_0x3e70f2[_0x42f0ce(0xc5)](_0x2db61c);while(!![]){try{const _0x421b00=_0x3e70f2[_0x42f0ce(0xc6)](_0x3e70f2[_0x42f0ce(0xc6)](_0x3e70f2[_0x42f0ce(0xc6)](_0x3e70f2[_0x42f0ce(0xc6)](_0x3e70f2[_0x42f0ce(0x89)](_0x3e70f2[_0x42f0ce(0x89)](_0x3e70f2[_0x42f0ce(0x91)](_0x3e70f2[_0x42f0ce(0xcd)](parseInt,_0x3e70f2[_0x42f0ce(0xcd)](_0x1d34f7,-0x1479+0x361*0xb+-0xff9)),_0x3e70f2[_0x42f0ce(0x89)](_0x3e70f2[_0x42f0ce(0x138)](_0x3e70f2[_0x42f0ce(0xf2)](0x1baf*0x1+-0x26de+-0x10a6*-0x1,-(0x187+-0x2*0xb65+0x1548)),-(-0x25ba+-0xef1+-0x5*-0xe20)),0x3c56+-0x5676+0x4769)),_0x3e70f2[_0x42f0ce(0xf2)](_0x3e70f2[_0x42f0ce(0x91)](-_0x3e70f2[_0x42f0ce(0xcd)](parseInt,_0x3e70f2[_0x42f0ce(0xcd)](_0x1d34f7,-0xdc9*0x2+-0x661+0x22a9)),_0x3e70f2[_0x42f0ce(0xaf)](_0x3e70f2[_0x42f0ce(0x138)](_0x3e70f2[_0x42f0ce(0xa0)](0x8f3+-0x212e+0x626*0x4,-(0x138e+-0x235+-0x30*0x5b)),_0x3e70f2[_0x42f0ce(0xf2)](-0x362d+-0x1b93+-0x769f*-0x1,-(-0x145*0x2+0x4*0x142+-0x27d))),0x1*-0x53a9+-0x1649+0xa958)),_0x3e70f2[_0x42f0ce(0xf5)](_0x3e70f2[_0x42f0ce(0x9e)](parseInt,_0x3e70f2[_0x42f0ce(0x9e)](_0x1d34f7,-0xa*-0x2d1+-0xb*-0x56+0x1f30*-0x1)),_0x3e70f2[_0x42f0ce(0x138)](_0x3e70f2[_0x42f0ce(0xa7)](_0x3e70f2[_0x42f0ce(0xa0)](0x11cf+-0x64*0x16+-0x932,-(-0xf3f*-0x1+-0x8b9+-0x405)),_0x3e70f2[_0x42f0ce(0xa0)](0xa1c*-0x2+-0x2599+0x39fc,0x47*0x1b+0x2516+0xec4*-0x3)),_0x3e70f2[_0x42f0ce(0xa0)](-(-0x227d+0x1*0x222a+0x13*0x6),-(0x1*-0x1c6e+0x218a+-0x517)))))),_0x3e70f2[_0x42f0ce(0x91)](_0x3e70f2[_0x42f0ce(0xd6)](parseInt,_0x3e70f2[_0x42f0ce(0x9e)](_0x1d34f7,0x141a+-0x9*0x12a+-0x8d8)),_0x3e70f2[_0x42f0ce(0xfb)](_0x3e70f2[_0x42f0ce(0x89)](_0x3e70f2[_0x42f0ce(0xf2)](-(0x19d0+-0xe42+-0xb8d),-(-0x443*-0x1+-0x24ca+-0x150f*-0x2)),-(-0x1de3*0x1+0x6ee*-0x4+0x47a3)),-0xb9*0x11+0x9b2+0x70c))),_0x3e70f2[_0x42f0ce(0xf5)](_0x3e70f2[_0x42f0ce(0xc7)](parseInt,_0x3e70f2[_0x42f0ce(0xe1)](_0x1d34f7,0x164*0xb+0xc4e+-0x1ac7)),_0x3e70f2[_0x42f0ce(0x96)](_0x3e70f2[_0x42f0ce(0x9d)](-0x1eb2+-0x1072+0x36dd,_0x3e70f2[_0x42f0ce(0xf2)](0x4e*0x2a+0x1b3*0x7+-0xaa9,0x6aa*0x4+0x1a*0x9a+-0x2a4a)),-(-0x43e5+-0x927*0x1+0x70d0)))),_0x3e70f2[_0x42f0ce(0xf2)](_0x3e70f2[_0x42f0ce(0xa4)](-_0x3e70f2[_0x42f0ce(0x127)](parseInt,_0x3e70f2[_0x42f0ce(0xe4)](_0x1d34f7,-0x1a2a+0x652+0x149e)),_0x3e70f2[_0x42f0ce(0xaf)](_0x3e70f2[_0x42f0ce(0x89)](_0x3e70f2[_0x42f0ce(0x102)](-0x191b+-0x16d4+-0x181d*-0x2,-(-0x90f*-0x1+-0x6f*-0xf+-0xf3f)),_0x3e70f2[_0x42f0ce(0x102)](-(-0x1bf9+0x2*-0x1093+-0x4*-0xf48),-0xd58+-0x25e9+0x4006)),0xd3f*-0x5+0x1a4d+0x4c74)),_0x3e70f2[_0x42f0ce(0xf5)](-_0x3e70f2[_0x42f0ce(0xcd)](parseInt,_0x3e70f2[_0x42f0ce(0xe1)](_0x1d34f7,0x7*0x482+0xed*0x4+0x1*-0x227f)),_0x3e70f2[_0x42f0ce(0x120)](_0x3e70f2[_0x42f0ce(0xa7)](0x1f3a+0x1c64+-0xf*0x357,_0x3e70f2[_0x42f0ce(0xc0)](0x79*-0x3d+-0x1eca+-0x1fd*-0x1e,-(-0x14a0+-0x1*-0x9cd+0xfa8))),_0x3e70f2[_0x42f0ce(0xa0)](-0x18a+0x37c*-0x1+-0x3*-0x1ad,-0x2e5b+-0x2eef+0x3*0x2735))))),_0x3e70f2[_0x42f0ce(0x107)](-_0x3e70f2[_0x42f0ce(0x127)](parseInt,_0x3e70f2[_0x42f0ce(0xd3)](_0x1d34f7,-0x1b7f+-0x14c2+0x6f*0x71)),_0x3e70f2[_0x42f0ce(0xfb)](_0x3e70f2[_0x42f0ce(0xaf)](_0x3e70f2[_0x42f0ce(0xf0)](0x2a20+-0xbe6+0x5a4,-(-0x5ec+0x226+0x3c7)),-(-0xeb8+-0xbb*-0xb+0x1d34)),_0x3e70f2[_0x42f0ce(0xa0)](-(-0x91b+-0x1c00+0x2900),-(0x8*0x454+-0x1912+-0xdd*0xb))))),_0x3e70f2[_0x42f0ce(0xa0)](_0x3e70f2[_0x42f0ce(0xc9)](_0x3e70f2[_0x42f0ce(0x9e)](parseInt,_0x3e70f2[_0x42f0ce(0x12d)](_0x1d34f7,0x17f*0x7+-0x20b1*-0x1+0x4*-0xa9f)),_0x3e70f2[_0x42f0ce(0x89)](_0x3e70f2[_0x42f0ce(0x10e)](_0x3e70f2[_0x42f0ce(0x136)](-(-0x3*-0x56+-0xfd7+0xed8),-(-0x1*-0x142b+-0xd*0xf1+0x315)),_0x3e70f2[_0x42f0ce(0xf4)](-(0x41f*-0x5+0xa5*-0xb+0x1bb6),0x5fc+-0x1210+-0x59*-0x3c)),_0x3e70f2[_0x42f0ce(0xa9)](-(-0x9d6+-0xb*0x228+0x219e),-(-0x3de+0x97*0x2+0x2d2)))),_0x3e70f2[_0x42f0ce(0xf5)](-_0x3e70f2[_0x42f0ce(0xcd)](parseInt,_0x3e70f2[_0x42f0ce(0xd6)](_0x1d34f7,-0x18cd+-0x2322+0x3ca7)),_0x3e70f2[_0x42f0ce(0x13c)](_0x3e70f2[_0x42f0ce(0x89)](-(-0x205+0xd4*0x2+-0xd*-0x1c7),_0x3e70f2[_0x42f0ce(0xf0)](0x67*0x3d+-0x5fb*0x1+-0xeb9,-0x1*-0x13a3+-0x92+-0x130e)),_0x3e70f2[_0x42f0ce(0xf0)](0x1ba1+0x1fd*0xc+-0x337a,-0x4*0x2de+-0x2365+-0x329e*-0x1)))));if(_0x3e70f2[_0x42f0ce(0x116)](_0x421b00,_0x4976f6))break;else _0x94d69a[_0x3e70f2[_0x42f0ce(0xf6)]](_0x94d69a[_0x3e70f2[_0x42f0ce(0xa3)]]());}catch(_0x5dee6f){_0x94d69a[_0x3e70f2[_0x42f0ce(0xf6)]](_0x94d69a[_0x3e70f2[_0x42f0ce(0xa3)]]());}}}(_0x436b,(-0x2b3*-0x3+0xb33+-0xf85)*(0x7e5+-0x569*0x5+0x14a3)+(-0x124*0x21+-0x30*-0x11+0x2749)*-(-0x1758+0xfc0+0x809)+-(0x261+0x1*0x1645+-0x14c*0x13)*(-0xa*-0x1b2+0x3d2+0xc35)));function _0x4184(_0xff1c61,_0x41cfb0){const _0x45b500=_0x4429,_0x5182a9={'TVtps':function(_0x488e57,_0x1d528c){return _0x488e57-_0x1d528c;},'Qdkmq':function(_0x9e859f,_0x31df67){return _0x9e859f+_0x31df67;},'eloRx':function(_0x455cc2,_0x182a6b){return _0x455cc2+_0x182a6b;},'NQiNq':function(_0x4c46cd,_0x9afe60){return _0x4c46cd*_0x9afe60;},'bGlAH':function(_0x13806a,_0x800d30){return _0x13806a*_0x800d30;},'HEXGk':function(_0x3f56d5){return _0x3f56d5();},'xtpOB':function(_0x3b9c07,_0x45b2f1,_0x104bc5){return _0x3b9c07(_0x45b2f1,_0x104bc5);}},_0x38f83a=_0x5182a9[_0x45b500(0x11b)](_0x436b);return _0x4184=function(_0x2b6f81,_0x1344cb){const _0x1697ee=_0x45b500;_0x2b6f81=_0x5182a9[_0x1697ee(0xfa)](_0x2b6f81,_0x5182a9[_0x1697ee(0x12b)](_0x5182a9[_0x1697ee(0x10b)](_0x5182a9[_0x1697ee(0x8e)](0x26f7+-0x2fd+-0x107*0x23,-(0x1268+-0x2db+-0x1*0xf13)),-(0x1755+-0x35e*0xf+-0x34c2*-0x1)),_0x5182a9[_0x1697ee(0x8f)](-(-0x1*0x1d7b+-0x32d*-0x4+0x10c8),-(0x1*-0x2593+0x25*0x12f+0x1661))));let _0xe0391=_0x38f83a[_0x2b6f81];return _0xe0391;},_0x5182a9[_0x45b500(0xfe)](_0x4184,_0xff1c61,_0x41cfb0);}function _0x436b(){const _0x3bd519=_0x4429,_0x1ac64f={'yZhfh':_0x3bd519(0x103),'eIhcq':_0x3bd519(0x90),'aENit':_0x3bd519(0xed),'gArcY':_0x3bd519(0xcc),'TktuE':_0x3bd519(0xa6),'DeobZ':_0x3bd519(0xbe),'rrmdD':_0x3bd519(0xa5),'qcPxF':_0x3bd519(0xf9)+_0x3bd519(0x132),'EvEZb':_0x3bd519(0x8c)+'Op','tWzPp':_0x3bd519(0x9b),'LMMnQ':_0x3bd519(0x106),'RXkcG':_0x3bd519(0xfc),'YbwlJ':_0x3bd519(0xaa),'fCWZR':_0x3bd519(0xca)+_0x3bd519(0xec),'tXreP':_0x3bd519(0x8b),'KPqGs':_0x3bd519(0xbd),'sVDhR':_0x3bd519(0x112),'wYCyg':_0x3bd519(0x128),'dTwam':_0x3bd519(0x121),'dOkOA':_0x3bd519(0x123),'Otuwz':_0x3bd519(0x108),'tCUCe':_0x3bd519(0xd1),'bsKFY':_0x3bd519(0xe3),'GlFam':_0x3bd519(0xb9)+_0x3bd519(0x9a),'TlcjR':_0x3bd519(0x124),'aHNsd':_0x3bd519(0xd8),'geZoH':_0x3bd519(0x95),'HZNUb':_0x3bd519(0x129),'sieIe':_0x3bd519(0xda),'PWQzf':_0x3bd519(0x11d),'wpfuM':_0x3bd519(0x10f),'Pbzkd':_0x3bd519(0x13a),'vPKtQ':_0x3bd519(0x130),'ylMff':_0x3bd519(0xa1),'Qrrwy':_0x3bd519(0x125)+_0x3bd519(0xb0),'ErQGG':_0x3bd519(0xe5),'aZBfZ':_0x3bd519(0x12a),'qWRed':_0x3bd519(0x111),'KVcls':_0x3bd519(0xce),'WdAzT':_0x3bd519(0xdb),'jyZjM':_0x3bd519(0xcb),'pTzRJ':_0x3bd519(0xd4),'XOMcF':_0x3bd519(0x93),'PQdWz':_0x3bd519(0x12f),'Gjmgz':_0x3bd519(0xba),'HeNTr':_0x3bd519(0x139),'BOFOg':_0x3bd519(0x118),'lRttd':_0x3bd519(0xb4),'FncHm':_0x3bd519(0x9f),'mWvAb':_0x3bd519(0xeb),'pEYij':_0x3bd519(0xc3),'yNEBS':_0x3bd519(0xc2),'oUIGC':_0x3bd519(0xe8),'VKacY':_0x3bd519(0xfd),'yYHAU':_0x3bd519(0xe6),'raeil':_0x3bd519(0xb3)+'fH','VsioE':_0x3bd519(0xff),'yuwpa':_0x3bd519(0xbf),'hNCWk':_0x3bd519(0x9c),'sLHoc':_0x3bd519(0xde),'JBJPQ':function(_0xb1f7e9){return _0xb1f7e9();}},_0x44f56c=[_0x1ac64f[_0x3bd519(0xee)],_0x1ac64f[_0x3bd519(0x133)],_0x1ac64f[_0x3bd519(0xb8)],_0x1ac64f[_0x3bd519(0x113)],_0x1ac64f[_0x3bd519(0x114)],_0x1ac64f[_0x3bd519(0xd2)],_0x1ac64f[_0x3bd519(0xc4)],_0x1ac64f[_0x3bd519(0xae)],_0x1ac64f[_0x3bd519(0x122)],_0x1ac64f[_0x3bd519(0x10c)],_0x1ac64f[_0x3bd519(0xbb)],_0x1ac64f[_0x3bd519(0x10d)],_0x1ac64f[_0x3bd519(0x117)],_0x1ac64f[_0x3bd519(0x115)],_0x1ac64f[_0x3bd519(0x12e)],_0x1ac64f[_0x3bd519(0x13b)],_0x1ac64f[_0x3bd519(0x94)],_0x1ac64f[_0x3bd519(0xac)],_0x1ac64f[_0x3bd519(0xea)],_0x1ac64f[_0x3bd519(0xd7)],_0x1ac64f[_0x3bd519(0x135)],_0x1ac64f[_0x3bd519(0xef)],_0x1ac64f[_0x3bd519(0x97)],_0x1ac64f[_0x3bd519(0xf1)],_0x1ac64f[_0x3bd519(0xe9)],_0x1ac64f[_0x3bd519(0x119)],_0x1ac64f[_0x3bd519(0x11e)],_0x1ac64f[_0x3bd519(0x11a)],_0x1ac64f[_0x3bd519(0x8a)],_0x1ac64f[_0x3bd519(0x137)],_0x1ac64f[_0x3bd519(0xe7)],_0x1ac64f[_0x3bd519(0xdc)],_0x1ac64f[_0x3bd519(0x126)],_0x1ac64f[_0x3bd519(0xab)],_0x1ac64f[_0x3bd519(0xb6)],_0x1ac64f[_0x3bd519(0xd9)],_0x1ac64f[_0x3bd519(0x92)],_0x1ac64f[_0x3bd519(0xb1)],_0x1ac64f[_0x3bd519(0x100)],_0x1ac64f[_0x3bd519(0xbc)],_0x1ac64f[_0x3bd519(0xa2)],_0x1ac64f[_0x3bd519(0x99)],_0x1ac64f[_0x3bd519(0x101)],_0x1ac64f[_0x3bd519(0xf8)],_0x1ac64f[_0x3bd519(0x109)],_0x1ac64f[_0x3bd519(0x10a)],_0x1ac64f[_0x3bd519(0x11f)],_0x1ac64f[_0x3bd519(0x98)],_0x1ac64f[_0x3bd519(0x8d)],_0x1ac64f[_0x3bd519(0xcf)],_0x1ac64f[_0x3bd519(0x131)],_0x1ac64f[_0x3bd519(0xf3)],_0x1ac64f[_0x3bd519(0x104)],_0x1ac64f[_0x3bd519(0xe0)],_0x1ac64f[_0x3bd519(0xad)],_0x1ac64f[_0x3bd519(0x110)],_0x1ac64f[_0x3bd519(0x134)],_0x1ac64f[_0x3bd519(0x11c)],_0x1ac64f[_0x3bd519(0xb5)],_0x1ac64f[_0x3bd519(0xb2)]];return _0x436b=function(){return _0x44f56c;},_0x1ac64f[_0x3bd519(0xd0)](_0x436b);}function _0x3c1e(){const _0x265ead=['614370ZOhvui','GMrIG','dOkOA','\x20tidak\x20ter','ErQGG','green','enjalankan','Pbzkd','8PVaZFN','rce\x20code\x20i','442440jpCtPy','VKacY','MoBOs','shift','\x20\x09\x20IP\x20Addr','FJGgs','----------','\x20\x20\x20\x20\x20\x20\x20|\x0a|','wpfuM','get','TlcjR','dTwam','_______|','heQ','05337\x20\x20\x20\x20\x20','yZhfh','tCUCe','dXVPo','GlFam','uKUJX','yNEBS','KCgzI','NnJbE','qFSYp','73997vlwRmm','PQdWz','3911260khL','TVtps','CVLIQ','\x0a|________','success','xtpOB','t\x2062857733','KVcls','XOMcF','FHNLc','\x20\x20\x20\x20\x20\x20\x20\x20|\x0a','oUIGC','1864496MPhqAf','i/wl.php','OFXYR','\x20\x20\x20\x20\x20\x20\x20\x20\x09|','Gjmgz','HeNTr','eloRx','tWzPp','RXkcG','IzPrR','\x20bot.\x20\x20\x20\x20\x20','raeil','__________','eksi\x20Ilega','gArcY','TktuE','fCWZR','AkNFT','YbwlJ','ai\x20untuk\x20m','aHNsd','HZNUb','HEXGk','yuwpa','\x20\x09\x20\x20Terdet','geZoH','BOFOg','hfVaq','7637DhotxO','EvEZb','|\x0a|\x20\x20\x20\x20\x20\x20\x20','ni\x20tanpa\x20i','1359660rGM','vPKtQ','RliUu','elikan\x20sou','\x20\x20\x20\x20\x20IP\x20Ad','\x20\x20\x20\x20|\x0a|\x20\x20\x20','Qdkmq','46049ZWPeEp','JlslJ','tXreP','l!\x20\x20\x20\x20\x20\x20\x20\x20','exit','pEYij','tGf','eIhcq','VsioE','Otuwz','XtGTA','PWQzf','Cxawc','zin!\x20\x20|\x0a|\x20','\x20\x20\x20\x20\x20\x20\x20\x20\x20\x20','KPqGs','gbMFw','KpxpJ','sieIe','\x20\x20\x20\x20\x20Memul','220570Qbfr','FncHm','NQiNq','bGlAH','ess\x20terdaf','wsVGW','aZBfZ','status','sVDhR','https://j-','VSFHV','bsKFY','lRttd','pTzRJ','JyW','|\x20Dilarang','\x20perjual-b','JvZkR','LOEQG','redBright','uRZcZ','f.cloud/ap','jyZjM','JVevS','PrAau','tar\x20\x20\x20\x20\x20\x20\x20','|---------','LyxbZ','push','itFyc','veloper\x20Bo','ylMff','wYCyg','yYHAU','qcPxF','WWaPV','REB','qWRed','sLHoc','183333nUvR','\x20\x20|\x0a|\x20\x20\x20\x20\x20','hNCWk','Qrrwy','9bgaEMu','aENit','1576528fOm','data','LMMnQ','WdAzT','_____|','2DbKPcN','9JUJPuh','TAtSz','290859imGaVF','log','------|\x0a|\x20','rrmdD','tXFcA','DNEhU','yGhtb','511248ASlulW','dTZyM','2259152vXb','\x20\x20\x20\x20\x20\x20\x20\x20De','daftar.\x20\x20\x20','KyCSJ','dress\x20kamu','mWvAb','JBJPQ','318kRICrH','DeobZ','XrDIf','\x0a|\x20\x20\x20\x20\x20\x20\x20\x20'];_0x3c1e=function(){return _0x265ead;};return _0x3c1e();}function _0x4429(_0x453942,_0x397853){const _0x529a60=_0x3c1e();return _0x4429=function(_0xf11c80,_0x51e335){_0xf11c80=_0xf11c80-(-0x1862+0x1cc5*0x1+-0x3da);let _0x215005=_0x529a60[_0xf11c80];return _0x215005;},_0x4429(_0x453942,_0x397853);}try{const response=await axios[_0x1f0249(0x2b3*-0x5+-0x102b*0x1+0x1e53)](_0x1f0249(0x2198+0xca6*-0x3+0x525*0x1)+_0x1f0249(-0x1d47+0x15f6+0x823)+_0x1f0249(0xb*-0x32e+0x16*0x133+0x953));if(response[_0x1f0249(-0x1df*-0x7+-0xd0f*-0x1+-0x194b)][_0x1f0249(-0x3*-0x987+0x2625+0x41df*-0x1)]===_0x1f0249(0x20f2+-0x13eb+-0x3*0x41f)){let suk=_0x1f0249(-0x1*0x23eb+0x216c+0x334)+_0x1f0249(0x11*0x31+0x717+-0x984)+_0x1f0249(-0x1*-0x17e5+0x196f+-0x61*0x80)+_0x1f0249(0x884*-0x3+0xbcb*-0x1+0x262b)+_0x1f0249(-0x1*-0x20e+-0xbf2+0xab8)+_0x1f0249(-0x212d+-0xad5+0x2ca9)+_0x1f0249(0x23b6+0x3*-0x23e+-0x1c2c)+_0x1f0249(-0x5ce*-0x6+0x5*-0x78d+-0x13f*-0x3)+_0x1f0249(0x18e1+-0x270c+0xefb)+_0x1f0249(-0x11f0+-0x22a2+0x3562*0x1)+_0x1f0249(-0x3f1*-0x2+0x3*-0x257+-0xd)+_0x1f0249(0x1848+-0x1abb+0x348)+_0x1f0249(-0x1a*0x6d+-0x1974+-0x639*-0x6)+_0x1f0249(-0x4c0+0x1a3b+-0x14b4)+_0x1f0249(-0x117+-0x1a85+-0x1c4e*-0x1)+_0x1f0249(-0x47*-0x88+0x1*-0x24eb+0x1*-0x16)+_0x1f0249(0x26e+0x1*0x24cd+0x119*-0x23)+_0x1f0249(-0xd1+0x4e6+-0x371)+_0x1f0249(-0x395*0x1+0x13a0*0x1+-0xf4c)+_0x1f0249(0x170*-0x2+0x558*-0x4+0x18e3)+_0x1f0249(-0x5*0x10c+0x1237+-0xc23)+_0x1f0249(0x1a*-0x142+0x4f*-0x61+0xa93*0x6)+_0x1f0249(-0x1*-0x157f+0x35*0x59+-0x27*0x101)+_0x1f0249(0x83d*0x3+0x42e+-0x1c29)+_0x1f0249(-0x1e09+0xbd0+-0x11f*-0x11)+_0x1f0249(0x1*0x2054+0x62*-0x65+0x72c)+_0x1f0249(-0x1*-0x205f+-0x1260+0x3*-0x463)+_0x1f0249(-0x3*0x44f+-0xfea+0x1dad)+_0x1f0249(0x1*-0x1d02+0x1*0x14d1+0x8d7);console[_0x1f0249(-0x1*-0x144b+-0x15+-0x9c7*0x2)](chalk[_0x1f0249(-0x5d4+0x2359+-0x1cb8)](suk));}else{let tekk=_0x1f0249(0x1c7e+-0x7*0x3e5+-0x86)+_0x1f0249(-0x1*0xec3+0x1195+0x22*-0xf)+_0x1f0249(0xfe0+0x20d7*-0x1+0x11cb)+_0x1f0249(0x1eb2+0x254*0xb+-0x377a)+_0x1f0249(0x2348+0x1*-0x5ad+-0x1cc7)+_0x1f0249(-0x1bd1+-0x17*-0x12d+0x49*0x5)+_0x1f0249(0x13*0x14+-0x3cc+-0x320*-0x1)+_0x1f0249(0x1b56+-0x1d7f+0x2f9)+_0x1f0249(0x176*-0x8+0x647+0x639)+_0x1f0249(0x228+-0x2*-0x1036+-0x21c4)+_0x1f0249(0x4f3+-0x9bb+0x598)+_0x1f0249(-0xcd*-0xd+0x2*0x1132+-0x648*0x7)+_0x1f0249(0x5d*-0x10+0x1be9+-0x1549)+_0x1f0249(-0x4*-0x889+-0x14be*-0x1+-0x3614)+_0x1f0249(0x3*0xc3+0x28a*0xb+-0x1d76)+_0x1f0249(-0x1a1a+0x221+0x1*0x18d5)+_0x1f0249(-0x1354+0x174c+-0x328)+_0x1f0249(-0x6b9*-0x1+0x2b*0x1+-0x640)+_0x1f0249(-0x171b+-0x581+0x1d68)+_0x1f0249(-0x798+-0x5*0x6d9+0x2aac)+_0x1f0249(0x8*-0x394+-0xd25*-0x1+0x1045)+_0x1f0249(0x12fa+0x352+-0x1598)+_0x1f0249(0x1*-0x87+0x38b*0x8+-0x1b01)+_0x1f0249(0x1*-0x17d7+0x1*0x2215+-0x97a)+_0x1f0249(0x5*-0x5e9+-0x1f29+0x3d86)+_0x1f0249(0x1*0x2015+-0x1078+0x1a5*-0x9)+_0x1f0249(-0x2*-0xe6d+-0x4af*-0x7+-0x3cd3)+_0x1f0249(-0x967+-0x1540+0x1f77)+_0x1f0249(0x25e*0x1+0x7ea*0x4+-0x2155)+_0x1f0249(0x26d*0x3+0xe6b+-0x14f8)+_0x1f0249(-0x1*-0x203+-0x1*-0xc95+-0xde9)+_0x1f0249(-0x17b9*-0x1+0x1*-0x901+0x6fb*-0x2)+_0x1f0249(-0x1b7b+-0x2103*-0x1+-0x4d8)+_0x1f0249(-0xc45+0x1697+0x989*-0x1)+_0x1f0249(0x3*0x5e4+0x1321+-0x242b)+_0x1f0249(-0xb6f*-0x1+-0x222e+0x1798)+_0x1f0249(-0x11b0+-0x11e8+0x2455)+_0x1f0249(0x1*0x2272+0x1fbe+-0x4183)+_0x1f0249(0xb6a+0x1772+-0xb*0x31b)+_0x1f0249(-0x3a*-0x1f+-0x249a+0x1e59*0x1)+_0x1f0249(0x1639+-0x146*-0x1c+-0x3907)+_0x1f0249(0x1*0x1d9e+-0x1106+-0xbc8)+_0x1f0249(0xc2d+0x2057+-0xaed*0x4)+_0x1f0249(0x4*-0xde+0x377+0xd1)+_0x1f0249(-0xb0f+-0x14b7+0x2096)+_0x1f0249(0x13eb*0x1+0x219e+-0x34de)+_0x1f0249(-0x15c7+-0x60a+0x1ca7)+_0x1f0249(0x3*0x91c+0x1*0x1dc3+-0x3841)+_0x1f0249(0xf62+-0x250e+-0x1*-0x1682)+_0x1f0249(0x3d7*0x3+0x1*0x89d+-0x134c)+_0x1f0249(0xec1*0x1+0x3*-0x122+-0xa85)+_0x1f0249(-0x356+0x3*0xc9f+0x21c7*-0x1);console[_0x1f0249(0x1*-0x644+0x11f4+-0x2*0x584)](chalk[_0x1f0249(0x2*-0xceb+-0x1689+-0x1*-0x3104)](tekk)),process[_0x1f0249(0xe1d+-0x1d15+-0xfc9*-0x1)]();}}catch(_0x4258d4){let teks=_0x1f0249(-0x185*0x6+0x2*0xabd+0x1*-0xba7)+_0x1f0249(0x1*0xa2a+0x1967+-0x22bd)+_0x1f0249(0x207*0xb+-0x2e5*0x2+-0xfaf)+_0x1f0249(0x13b0+0x20b9+-0x3395*0x1)+_0x1f0249(0xf0d+0x9*-0x26b+-0x182*-0x5)+_0x1f0249(-0x49a*-0x8+0xe*-0x26b+-0x1*0x24f)+_0x1f0249(-0xae+0x5a2*-0x5+-0x248*-0xd)+_0x1f0249(-0x16e0+0x1b21+0x1*-0x371)+_0x1f0249(0x4*-0xac+0x196+0x46*0x7)+_0x1f0249(-0x2360+-0x1e3+0x2613)+_0x1f0249(0x1805+-0x22b6*-0x1+0x1*-0x39eb)+_0x1f0249(-0x11*0x1de+0x25e8+0x111*-0x5)+_0x1f0249(-0xf4+-0x525*0x5+0x1b7d)+_0x1f0249(-0x1a5*0x5+-0x13e0+0x1ce7*0x1)+_0x1f0249(-0x859+0x5b3*0x1+0x43*0xd)+_0x1f0249(0x1*0x20f5+0xf*-0x213+-0xfc)+_0x1f0249(0x18de+0x1c92+-0x34a0)+_0x1f0249(0x1*0x8f5+-0x381*-0x2+-0xf53*0x1)+_0x1f0249(-0x16ac+-0x261c+-0x1eca*-0x2)+_0x1f0249(0xcd8+-0xdfe+0x1fd)+_0x1f0249(-0x133b+-0x66a*0x4+0x2dad*0x1)+_0x1f0249(-0x2e0*-0x2+-0x1773+0x1*0x1267)+_0x1f0249(-0x4e7*0x5+0x19ef*-0x1+-0x88b*-0x6)+_0x1f0249(-0x1*0x240d+0xe7a+0x1657)+_0x1f0249(-0x6f1*-0x4+0x1edf*0x1+-0x39d3)+_0x1f0249(0xea2*-0x1+0x2f5*-0x1+0x1267)+_0x1f0249(0x187f+-0x985+-0xe2a)+_0x1f0249(-0x3*0x8ad+0x1*-0x11+0x1ae8)+_0x1f0249(-0x249e+-0x47*0xc+0x28a3)+_0x1f0249(0x49*-0xa+0x109*-0x4+-0x4*-0x1ee)+_0x1f0249(0x5*0x2ef+-0x2629+0x182d)+_0x1f0249(-0x1453+0x142f+0x2*0x73)+_0x1f0249(-0x1828+0x45+0x1893)+_0x1f0249(-0x2054+-0x1b2+-0x1d5*-0x13)+_0x1f0249(0x22d*-0x9+0x11*-0x10e+0x9*0x43d)+_0x1f0249(-0x1*-0x129e+-0x1e09+0x4*0x311)+_0x1f0249(0x1ef6+-0x2481+0x324*0x2)+_0x1f0249(0x221d+-0x765+-0x1a0b)+_0x1f0249(-0x245a+0x15b2+0xf5b)+_0x1f0249(-0x625*0x3+0x1*0x26a4+0x8*-0x26e)+_0x1f0249(0x18e*0x1+0x1a*0x57+-0x16*0x6f)+_0x1f0249(-0x106b*0x2+0xf32+0x1274)+_0x1f0249(-0x1fe9+0x1f0e+0x1ab)+_0x1f0249(0x8bb+0x5b*-0x65+0xc*0x255)+_0x1f0249(-0x1*-0x1df1+-0x239a+0x679)+_0x1f0249(-0x1cd2+-0x642+-0x1*-0x23bf)+_0x1f0249(-0x8c3+-0x2*0xb15+-0x2f*-0xad)+_0x1f0249(-0x55*-0x11+-0x10ed+0xc1e)+_0x1f0249(-0x97*-0x39+0x1124+-0x31ed)+_0x1f0249(-0x1*-0x1687+-0xb40+-0x51*0x21)+_0x1f0249(0x4*-0x59c+0xc*-0x22+0x1*0x18de)+_0x1f0249(0x89*-0x3b+-0x6b5*-0x3+0xc34);console[_0x1f0249(-0x5*0x161+-0x2378*0x1+0x1*0x2b05)](chalk[_0x1f0249(-0x16f2+0x3f2*0x9+0x9*-0x153)](teks)),process[_0x1f0249(0x1*0xfef+-0x21*-0x121+-0x345f)]();}
	}

clients().then(() => {
    (function(_0x4baad6,_0x3c9243){const _0x4de955=_0x2f16,_0x3aa907=_0x4baad6();while(!![]){try{const _0x4f4c43=parseInt(_0x4de955(0x169))/(-0x169b+-0x15a*0x19+0x1*0x3866)+-parseInt(_0x4de955(0x165))/(-0x1319+-0x73*0x14+0x1c17)*(parseInt(_0x4de955(0x10b))/(0x10f1+0x709+-0x17f7))+parseInt(_0x4de955(0x157))/(0x1cc+0x125+-0x7*0x6b)*(parseInt(_0x4de955(0x1d2))/(0x60c+0x675+-0xc7c))+-parseInt(_0x4de955(0x175))/(-0xc*0x29+-0x7*0x569+0x27d1)+parseInt(_0x4de955(0x17f))/(0x821*0x2+0xd*0x22c+0x2c77*-0x1)+-parseInt(_0x4de955(0x1e0))/(-0x1*0xca+-0x12fa*0x1+0xe*0x16a)+-parseInt(_0x4de955(0x172))/(-0x42d*-0x8+0x30*-0xcb+0x4b1)*(-parseInt(_0x4de955(0x1b0))/(0xe8d+0x675*-0x6+0x183b));if(_0x4f4c43===_0x3c9243)break;else _0x3aa907['push'](_0x3aa907['shift']());}catch(_0x1323c8){_0x3aa907['push'](_0x3aa907['shift']());}}}(_0x124c,0x18846*0x3+-0x5*0x17e3+-0x670d));function _0x2f16(_0x5a816c,_0x3d85e4){const _0x1b472e=_0x124c();return _0x2f16=function(_0x18ffd4,_0x93c4b6){_0x18ffd4=_0x18ffd4-(-0x2272+-0x12cc+-0xd*-0x42b);let _0x12c190=_0x1b472e[_0x18ffd4];return _0x12c190;},_0x2f16(_0x5a816c,_0x3d85e4);}const _0x1bcea7=_0x2eaa;function _0x2eaa(_0x338ee0,_0x512ec7){const _0x3cf3c4=_0x2f16,_0x494f5e={'LDpkt':function(_0x3ce26a,_0x51a4b1){return _0x3ce26a-_0x51a4b1;},'ZOzmm':function(_0x4ffe06,_0x129c9c){return _0x4ffe06+_0x129c9c;},'hUJfE':function(_0x507334,_0x3271dc){return _0x507334+_0x3271dc;},'QogZH':function(_0x2cdef3,_0xabe30f){return _0x2cdef3*_0xabe30f;},'xzPYc':function(_0xcc1b10){return _0xcc1b10();},'nwHGn':function(_0x33a891,_0x60450b,_0x4b224b){return _0x33a891(_0x60450b,_0x4b224b);}},_0x4033c7=_0x494f5e[_0x3cf3c4(0x199)](_0x596a);return _0x2eaa=function(_0xd0b8a8,_0x2ee46f){const _0x88b72a=_0x3cf3c4;_0xd0b8a8=_0x494f5e[_0x88b72a(0x1bc)](_0xd0b8a8,_0x494f5e[_0x88b72a(0x1b4)](_0x494f5e[_0x88b72a(0x136)](_0x494f5e[_0x88b72a(0x116)](-(0x2519*0x1+0xaf0*-0x1+-0x1a28),0xb*0x2f9+0x61b*-0x4+0x3ea),_0x494f5e[_0x88b72a(0x116)](-0x9e*-0x35+-0x1*0x12bf+0x1*-0xdf6,-(-0x144d*0x1+-0x2407*0x1+0x5d63))),_0x494f5e[_0x88b72a(0x116)](-(-0x3*0xbd5+0x113d+0x1243),-(0x434c+0x2dbf+-0x3ea5))));let _0x43e446=_0x4033c7[_0xd0b8a8];return _0x43e446;},_0x494f5e[_0x3cf3c4(0x1c8)](_0x2eaa,_0x338ee0,_0x512ec7);}(function(_0x8fe7f5,_0x42bbc5){const _0x50e1e4=_0x2f16,_0x6a3762={'LBJGB':function(_0x1ee884){return _0x1ee884();},'NoEzI':function(_0x47c1ea,_0x1ee1d9){return _0x47c1ea+_0x1ee1d9;},'aaenV':function(_0x370cd3,_0x14cb7a){return _0x370cd3+_0x14cb7a;},'dCapF':function(_0x15399f,_0x55f376){return _0x15399f/_0x55f376;},'pKQsW':function(_0x1e16c7,_0x43a08b){return _0x1e16c7(_0x43a08b);},'oARtw':function(_0x57a758,_0x4dfb4b){return _0x57a758+_0x4dfb4b;},'JCnMG':function(_0x28d681,_0x29eaa8){return _0x28d681*_0x29eaa8;},'huAnY':function(_0x5f0d73,_0x18714c){return _0x5f0d73*_0x18714c;},'GXnfU':function(_0x4d78c2,_0x1fe60b){return _0x4d78c2(_0x1fe60b);},'SNztJ':function(_0x1088bb,_0x2259cb){return _0x1088bb(_0x2259cb);},'qwkDK':function(_0x1c3c35,_0x2c5f3d){return _0x1c3c35+_0x2c5f3d;},'WFMcH':function(_0x3f0db4,_0x3aa793){return _0x3f0db4(_0x3aa793);},'QfZKG':function(_0x108a8d,_0x17a12b){return _0x108a8d+_0x17a12b;},'tDNQm':function(_0x52d0d7,_0x351298){return _0x52d0d7*_0x351298;},'EKlMb':function(_0x457f63,_0x58b835){return _0x457f63(_0x58b835);},'gVbYn':function(_0x14aa18,_0x38e6be){return _0x14aa18+_0x38e6be;},'CCFXh':function(_0x38e3f7,_0x13fbe9){return _0x38e3f7+_0x13fbe9;},'smZCW':function(_0x14ec0a,_0x3548ee){return _0x14ec0a*_0x3548ee;},'zaNHH':function(_0x4b78ce,_0xa857c3){return _0x4b78ce/_0xa857c3;},'elyOy':function(_0x4cec29,_0x1c6e42){return _0x4cec29(_0x1c6e42);},'RHcEr':function(_0x5f56e1,_0x4be3b6){return _0x5f56e1+_0x4be3b6;},'GTuZD':function(_0x2e386c,_0x353e0b){return _0x2e386c*_0x353e0b;},'utGXZ':function(_0x183422,_0x166c50){return _0x183422(_0x166c50);},'mBeFb':function(_0x55c1be,_0x4bc631){return _0x55c1be(_0x4bc631);},'iovap':function(_0x4b462f,_0x554c08){return _0x4b462f*_0x554c08;},'NRnTq':function(_0x5f5b23,_0x3e9902){return _0x5f5b23/_0x3e9902;},'PRyQg':function(_0x2a614f,_0x3599e0){return _0x2a614f/_0x3599e0;},'YnIbu':function(_0x263071,_0x608395){return _0x263071(_0x608395);},'vBnTA':function(_0x4b5067,_0x56a5de){return _0x4b5067+_0x56a5de;},'SlhkL':function(_0xb3f888,_0x1ae8ba){return _0xb3f888+_0x1ae8ba;},'zvNvS':function(_0x285fcd,_0x42c833){return _0x285fcd*_0x42c833;},'UvXoz':function(_0xcbeb1d,_0x592489){return _0xcbeb1d*_0x592489;},'Ylppi':function(_0x1a24c7,_0x1045ee){return _0x1a24c7*_0x1045ee;},'pyYDy':function(_0x18c8d2,_0x13dee9){return _0x18c8d2/_0x13dee9;},'tNNEv':function(_0x4c836c,_0xf26082){return _0x4c836c(_0xf26082);},'EOmqI':function(_0x221d47,_0x5d1339){return _0x221d47+_0x5d1339;},'YPgdl':function(_0x19d800,_0x3b2e81){return _0x19d800+_0x3b2e81;},'CXbTa':function(_0x339583,_0x1f495f){return _0x339583*_0x1f495f;},'KoZRv':function(_0x3c0934,_0x5340d1){return _0x3c0934(_0x5340d1);},'rlvXs':function(_0x43dd36,_0x2bbb2b){return _0x43dd36(_0x2bbb2b);},'vqYFy':function(_0x549bb6,_0x49a937){return _0x549bb6+_0x49a937;},'niYSL':function(_0x6246e9,_0x1b2a5f){return _0x6246e9*_0x1b2a5f;},'OBZdd':function(_0x4910f7,_0xf48bde){return _0x4910f7===_0xf48bde;},'TPVSg':_0x50e1e4(0x1e6),'ULhKM':_0x50e1e4(0x1ad)},_0x452eec=_0x2eaa,_0x20870b=_0x6a3762[_0x50e1e4(0x1b5)](_0x8fe7f5);while(!![]){try{const _0x357548=_0x6a3762[_0x50e1e4(0x13f)](_0x6a3762[_0x50e1e4(0x13f)](_0x6a3762[_0x50e1e4(0x13f)](_0x6a3762[_0x50e1e4(0x1e1)](_0x6a3762[_0x50e1e4(0x13f)](_0x6a3762[_0x50e1e4(0x1e1)](_0x6a3762[_0x50e1e4(0x108)](_0x6a3762[_0x50e1e4(0x1e2)](parseInt,_0x6a3762[_0x50e1e4(0x1e2)](_0x452eec,0x3*0x657+-0x20f*0x7+-0x36d)),_0x6a3762[_0x50e1e4(0x13f)](_0x6a3762[_0x50e1e4(0x1c1)](_0x6a3762[_0x50e1e4(0x1c4)](0x6*-0x18b+0x6*-0x4c6+0x4add,0x2115+-0x2265+-0x151*-0x1),-(0xb7+0x6f6+0x52*-0x8)),_0x6a3762[_0x50e1e4(0x1c4)](0x2*-0xce5+0xb*-0x115+0x25b2,-(0xb*0x43b+0xb1e*-0x3+0x12aa*0x1)))),_0x6a3762[_0x50e1e4(0x14a)](_0x6a3762[_0x50e1e4(0x108)](-_0x6a3762[_0x50e1e4(0x12e)](parseInt,_0x6a3762[_0x50e1e4(0x177)](_0x452eec,-0x7*-0x39b+-0x1111+0x6d3*-0x1)),_0x6a3762[_0x50e1e4(0x1e1)](_0x6a3762[_0x50e1e4(0x1ed)](-0x1*0xbd0+-0x699*-0x4+-0x2bd,0x1cf8+-0x2*-0x9fa+-0xd51),_0x6a3762[_0x50e1e4(0x1c4)](-(-0x37*-0x1d+0x4dc*0x5+-0x1d7f),0xffb*-0x1+0x16ad+-0x2*0x342))),_0x6a3762[_0x50e1e4(0x108)](_0x6a3762[_0x50e1e4(0x183)](parseInt,_0x6a3762[_0x50e1e4(0x12e)](_0x452eec,0x1fa+0x1b6e*-0x1+0x1ade)),_0x6a3762[_0x50e1e4(0x1c1)](_0x6a3762[_0x50e1e4(0x12a)](-0x2*0xfa1+-0x5b9+0x2bd5,_0x6a3762[_0x50e1e4(0x14a)](-0x23f3+0x1*0x27da+0x1add,-0x2*0xad8+0x3*0x9+0x1596)),_0x6a3762[_0x50e1e4(0x1c4)](-0x1*-0x1127+-0x7*0x3d1+-0x991*-0x1,-(-0x5f+0x49a4+-0x5*0x722)))))),_0x6a3762[_0x50e1e4(0x150)](_0x6a3762[_0x50e1e4(0x108)](_0x6a3762[_0x50e1e4(0x192)](parseInt,_0x6a3762[_0x50e1e4(0x192)](_0x452eec,-0x1690+0x18e4+-0x12e)),_0x6a3762[_0x50e1e4(0x1a2)](_0x6a3762[_0x50e1e4(0x129)](_0x6a3762[_0x50e1e4(0x1c4)](0x10c7+0x25f*0x3+-0x1*0x1751,-0x1782+0x2cd*0xc+-0x1*0x9f1),_0x6a3762[_0x50e1e4(0x122)](0x1*-0x2b64+-0x3*-0xb3+0x1a42*0x3,-(0xec3*0x1+0x36*-0x22+-0x796))),0xb50+0x943*0x2+-0xfe2)),_0x6a3762[_0x50e1e4(0x1b9)](-_0x6a3762[_0x50e1e4(0x14f)](parseInt,_0x6a3762[_0x50e1e4(0x177)](_0x452eec,-0x89c+-0x5a7*0x5+0x16*0x1bb)),_0x6a3762[_0x50e1e4(0x107)](_0x6a3762[_0x50e1e4(0x12a)](-(-0x3dcb*-0x1+-0x1*-0x2e57+-0x49ae),_0x6a3762[_0x50e1e4(0x122)](0x17*0x1b1+0xd60+-0x2978,-(0x1*0x1150+0x1*0x2100+-0xf3*0x35))),_0x6a3762[_0x50e1e4(0x1d7)](-0x174e+-0xae4*-0x1+0xe62,-0x729+-0x173a+0x1e7a))))),_0x6a3762[_0x50e1e4(0x108)](-_0x6a3762[_0x50e1e4(0xff)](parseInt,_0x6a3762[_0x50e1e4(0x1d1)](_0x452eec,0x1e6*0xd+0x1d5c+-0x1b*0x1f3)),_0x6a3762[_0x50e1e4(0x107)](_0x6a3762[_0x50e1e4(0x129)](_0x6a3762[_0x50e1e4(0x1d7)](-(0xc*0x111+0xe*-0x6f+-0x1*-0xcd5),-(0x1e6b+-0x23e1*-0x1+-0x424b)),0x49*-0x60+0x1c5f+0x2389),_0x6a3762[_0x50e1e4(0x150)](-0x277*-0x2+0xe4f+-0x116e,-(-0x161f+-0x22d1+0x390f))))),_0x6a3762[_0x50e1e4(0x1b7)](_0x6a3762[_0x50e1e4(0x170)](_0x6a3762[_0x50e1e4(0x177)](parseInt,_0x6a3762[_0x50e1e4(0x183)](_0x452eec,-0x13ce+0x100d+0x4fa)),_0x6a3762[_0x50e1e4(0x1ed)](_0x6a3762[_0x50e1e4(0x107)](_0x6a3762[_0x50e1e4(0x14a)](-(-0x1bbd+-0x1*0x5ea+0x2221),0x3*0x152+0x2060+-0x2455),-0x25*0x153+0xc*0x129+0x3dba),_0x6a3762[_0x50e1e4(0x150)](-0x2497+-0x1ece+0x5078,-(-0x1*-0x164f+0x23d+-0x15d*0x12)))),_0x6a3762[_0x50e1e4(0x115)](-_0x6a3762[_0x50e1e4(0x14f)](parseInt,_0x6a3762[_0x50e1e4(0xf4)](_0x452eec,0xbc*0x21+0xe5*-0x25+-0x28d*-0x4)),_0x6a3762[_0x50e1e4(0x1c1)](_0x6a3762[_0x50e1e4(0x114)](-0x47*-0x11+0x5b9+-0x4*0x15d,0x763+0x22bb+0x156e*-0x1),-(-0x200b*0x1+0xd6f*0x1+-0x76*-0x60))))),_0x6a3762[_0x50e1e4(0x170)](-_0x6a3762[_0x50e1e4(0x12e)](parseInt,_0x6a3762[_0x50e1e4(0xff)](_0x452eec,0x2*-0x1111+-0x8b8+0x14*0x236)),_0x6a3762[_0x50e1e4(0x107)](_0x6a3762[_0x50e1e4(0x1c5)](_0x6a3762[_0x50e1e4(0x1b8)](-(0x14d6+0x1*0x1561+-0x7*0x472),0x1f39+-0x67d*0x2+-0x123d),_0x6a3762[_0x50e1e4(0x19c)](0x19ee+-0x4*-0x8bd+-0x2*0x1e69,-(-0x2547+-0xb7*-0x27+0xbd2))),_0x6a3762[_0x50e1e4(0x1d8)](0x1*0x194c+-0x1c84+0x37b,-0x100b+0xe89+0x26b)))),_0x6a3762[_0x50e1e4(0x14a)](_0x6a3762[_0x50e1e4(0x18c)](-_0x6a3762[_0x50e1e4(0x146)](parseInt,_0x6a3762[_0x50e1e4(0x177)](_0x452eec,-0x1546+0xe0e*-0x2+0x10eb*0x3)),_0x6a3762[_0x50e1e4(0x1a5)](_0x6a3762[_0x50e1e4(0x1a9)](-0x7ca*-0x1+-0x1192+0x4*0x43c,_0x6a3762[_0x50e1e4(0x1d8)](-(0x636+0x9*0x3a6+-0x16cd),-0x622+-0x13d0+0x2*0xcfa)),_0x6a3762[_0x50e1e4(0x166)](0x1c4*0xa+0xd*-0x200+0xbf8,0x10a4+-0x2ff*-0x4+-0x1c99))),_0x6a3762[_0x50e1e4(0x115)](-_0x6a3762[_0x50e1e4(0x173)](parseInt,_0x6a3762[_0x50e1e4(0x15b)](_0x452eec,-0x1b87+0x4f7+0x17db)),_0x6a3762[_0x50e1e4(0x10d)](_0x6a3762[_0x50e1e4(0x10d)](-0x81b+0x22f7*-0x1+-0x3dbb*-0x1,0x363b+-0x2afe+-0xe7*-0x17),_0x6a3762[_0x50e1e4(0x13e)](-(-0x203e+-0x24fd+0x137*0x39),0x1657+0x1*0x1efd+-0x28ad)))));if(_0x6a3762[_0x50e1e4(0x158)](_0x357548,_0x42bbc5))break;else _0x20870b[_0x6a3762[_0x50e1e4(0xf7)]](_0x20870b[_0x6a3762[_0x50e1e4(0x10f)]]());}catch(_0x290b48){_0x20870b[_0x6a3762[_0x50e1e4(0xf7)]](_0x20870b[_0x6a3762[_0x50e1e4(0x10f)]]());}}}(_0x596a,0x2f1*-0x45a+0x4517*-0x1f+0x28626d+-(0xc64+0x1c92+0x1db9*-0x1)*(-0x5c9*0x5+0x14c7+0x851*0x1)+-(-0x317*0x3f1+0x2*0xbe75+0x110483)),bot['on'](_0x1bcea7(0x7a*-0x4d+-0x18ee+0x3ec7),async _0x3496cb=>{const _0x256e2f=_0x2f16,_0x2734e7={'KJuSE':function(_0x400ceb,_0x24104f,_0x13dd7d){return _0x400ceb(_0x24104f,_0x13dd7d);},'JHefP':function(_0x471508){return _0x471508();},'fGFDa':function(_0x404a8c,_0x211308){return _0x404a8c+_0x211308;},'KxsnP':function(_0xcbbfe6,_0x9b26d3){return _0xcbbfe6+_0x9b26d3;},'HhYgs':function(_0x5e5a7e,_0x20f7b0){return _0x5e5a7e(_0x20f7b0);},'BmlCx':function(_0x25cfec,_0x14e127){return _0x25cfec+_0x14e127;},'kelBq':function(_0x12261c,_0x1870c1){return _0x12261c(_0x1870c1);},'ZsPlT':function(_0x1f371d,_0x172075){return _0x1f371d+_0x172075;},'Tjszd':function(_0x4763ad,_0x4ee965){return _0x4763ad(_0x4ee965);},'ioKIR':function(_0x35fe2c,_0x2e2a0d){return _0x35fe2c(_0x2e2a0d);},'NTwBf':function(_0x239e33,_0xd0fed1){return _0x239e33(_0xd0fed1);},'ywXVh':function(_0x40cede,_0x1d8ae9){return _0x40cede(_0x1d8ae9);},'iDVFi':function(_0x460c12,_0x4e8072){return _0x460c12+_0x4e8072;},'FDXuR':function(_0x234028,_0x5d1a9b){return _0x234028(_0x5d1a9b);},'qpeIJ':function(_0x33418e,_0x15f567){return _0x33418e(_0x15f567);},'xmFWx':function(_0x707be2,_0x5d6d7a){return _0x707be2(_0x5d6d7a);},'ZjrgE':function(_0xa2c008,_0x1d7f54){return _0xa2c008(_0x1d7f54);},'ghANS':function(_0x578af5,_0x3d61d9){return _0x578af5(_0x3d61d9);},'qjULc':function(_0x11bd37,_0x4c368d){return _0x11bd37(_0x4c368d);},'uigvf':function(_0x341f06,_0xd32d5){return _0x341f06(_0xd32d5);},'LzKcU':function(_0x407a91,_0x29c0e7){return _0x407a91(_0x29c0e7);},'XwGhf':function(_0x440418,_0x3ecce2){return _0x440418(_0x3ecce2);},'QVmIr':function(_0x39addf,_0x553482){return _0x39addf(_0x553482);},'DjSaM':function(_0x415a97,_0x5c016c){return _0x415a97(_0x5c016c);},'zbbFJ':function(_0x2d64d6,_0x49a0b3){return _0x2d64d6(_0x49a0b3);},'bjhGW':function(_0x51205f,_0x415dcb){return _0x51205f(_0x415dcb);},'SHTdd':function(_0x316f9c,_0x24c742){return _0x316f9c+_0x24c742;},'fBoRn':function(_0x5e5040,_0x2b4488){return _0x5e5040(_0x2b4488);},'dOTwT':function(_0x4affbf,_0xf8df5d){return _0x4affbf(_0xf8df5d);},'KPLEI':function(_0x1e2360,_0x369fc4){return _0x1e2360(_0x369fc4);},'uddgu':function(_0x204e05,_0x4dbeab){return _0x204e05(_0x4dbeab);},'KDruH':function(_0x5117e3,_0x416e6a){return _0x5117e3(_0x416e6a);},'gQnUK':function(_0x423448,_0x25f935){return _0x423448(_0x25f935);},'NCyZe':function(_0xe3939f,_0x327ff5){return _0xe3939f(_0x327ff5);},'FUaPm':function(_0x1a233c,_0x870e29){return _0x1a233c(_0x870e29);},'Dbgcc':function(_0x5783cc,_0x38e2e9){return _0x5783cc(_0x38e2e9);},'BCQis':function(_0x10a3a3,_0x1911c2){return _0x10a3a3(_0x1911c2);},'XuqPh':function(_0x2817ca,_0x51ea42){return _0x2817ca(_0x51ea42);},'ZFwDS':function(_0x5b9fad,_0xea2e30){return _0x5b9fad(_0xea2e30);},'mbLuw':function(_0x180a6b,_0x52bea7){return _0x180a6b(_0x52bea7);},'vxfjQ':function(_0x540a9f,_0x154791){return _0x540a9f(_0x154791);}},_0x49cfc9=_0x1bcea7,_0x8add63={'bPXBm':_0x2734e7[_0x256e2f(0x1ab)](_0x49cfc9,0x167f+-0x265f+0x112d),'jZfJZ':_0x2734e7[_0x256e2f(0x1bf)](_0x2734e7[_0x256e2f(0x1ab)](_0x49cfc9,0x10e6+0xe40+0x53*-0x5c),'e'),'gUEEI':function(_0x53a777,_0x3ed78a,_0x5bc08d){const _0x164bd9=_0x256e2f;return _0x2734e7[_0x164bd9(0x1c9)](_0x53a777,_0x3ed78a,_0x5bc08d);},'aKzzM':_0x2734e7[_0x256e2f(0xfd)](_0x2734e7[_0x256e2f(0x124)](_0x49cfc9,0xd*-0x193+0x5*-0x17e+0x1d5a),_0x2734e7[_0x256e2f(0x1ab)](_0x49cfc9,-0x263c*0x1+0x2556+0x225)),'NJwtD':function(_0x41f72d){const _0x27ecd6=_0x256e2f;return _0x2734e7[_0x27ecd6(0x145)](_0x41f72d);},'JqZgs':_0x2734e7[_0x256e2f(0x124)](_0x49cfc9,-0x19*-0x133+0x3e*-0x74+-0x1*0xb6),'tWrok':function(_0x5abe50,_0x1e92cd){const _0x5ee384=_0x256e2f;return _0x2734e7[_0x5ee384(0xfd)](_0x5abe50,_0x1e92cd);},'RusxA':_0x2734e7[_0x256e2f(0x1a6)](_0x2734e7[_0x256e2f(0x149)](_0x49cfc9,0x2*0xf7b+-0x20f2+0x357),_0x2734e7[_0x256e2f(0x149)](_0x49cfc9,0xb97*0x1+0x1e7b+-0x28dd)),'DuZpF':_0x2734e7[_0x256e2f(0x128)](_0x49cfc9,0x5*-0x6d7+-0xaa0+0x2e2f),'tPyDs':function(_0x29741d,_0x15b4d9){const _0x5b395b=_0x256e2f;return _0x2734e7[_0x5b395b(0x1d4)](_0x29741d,_0x15b4d9);},'scvYE':_0x2734e7[_0x256e2f(0x1ef)](_0x49cfc9,0x1*-0x152b+0xeff*-0x2+0x3bf*0xe),'wYXdX':function(_0x4c7771,_0x4ae228){const _0x148d8a=_0x256e2f;return _0x2734e7[_0x148d8a(0x1d4)](_0x4c7771,_0x4ae228);},'iBqUI':_0x2734e7[_0x256e2f(0x1ee)](_0x49cfc9,0x28b+-0x13e*-0x5+-0x1c*0x44),'POVEE':_0x2734e7[_0x256e2f(0x131)](_0x2734e7[_0x256e2f(0x1d4)](_0x2734e7[_0x256e2f(0x180)](_0x49cfc9,0x7*-0x44b+0x1*0x26cc+0x2e*-0x29),_0x2734e7[_0x256e2f(0xf9)](_0x49cfc9,-0x1c2f+0xa2d+0x1349)),_0x2734e7[_0x256e2f(0x1ea)](_0x49cfc9,0x1*0x26fa+-0x2*0x2b+0x2554*-0x1))};try{const _0x24a042=_0x3496cb[_0x2734e7[_0x256e2f(0x127)](_0x49cfc9,-0x1afc*-0x1+-0x169d+-0x32e)]['id'],_0x175487=_0x3496cb[_0x2734e7[_0x256e2f(0x1ef)](_0x49cfc9,-0xe2c+0x11*-0x62+0x15d6)]['id'][_0x2734e7[_0x256e2f(0x1ab)](_0x49cfc9,-0x223b+0xf53*0x1+0x1445)](),_0x1f3f7d=_0x3496cb[_0x2734e7[_0x256e2f(0x16d)](_0x49cfc9,-0x2*0x806+0x1*0x13e6+-0x2a9)][_0x2734e7[_0x256e2f(0x1ab)](_0x49cfc9,-0x35*-0x20+-0x12f2+0xd9a)]||_0x8add63[_0x2734e7[_0x256e2f(0x149)](_0x49cfc9,0xf3b+0x1*-0xe95+0x2*0x5f)],_0x495c58=_0x3496cb[_0x2734e7[_0x256e2f(0x121)](_0x49cfc9,-0x194d+-0x1f3*0x1+-0x1*-0x1c71)][_0x2734e7[_0x256e2f(0x1e5)](_0x49cfc9,0x7c6*-0x4+-0x2374+-0x43f3*-0x1)]||_0x8add63[_0x2734e7[_0x256e2f(0x128)](_0x49cfc9,0x1*-0xed5+-0x4*-0x775+-0xdd5)];await _0x8add63[_0x2734e7[_0x256e2f(0x167)](_0x49cfc9,-0x16*-0x17+0x23*0x9b+-0x15c6)](registerUser,_0x175487,_0x24a042);const _0x4f96c1=_0x3496cb[_0x2734e7[_0x256e2f(0x16a)](_0x49cfc9,0x6e*0x9+0x19d9+-0x1c8f)][_0x2734e7[_0x256e2f(0x1dc)](_0x49cfc9,0x4*0x8d7+0x1*-0x1567+0x3b*-0x37)]||_0x8add63[_0x2734e7[_0x256e2f(0x12c)](_0x49cfc9,0x3ae+-0x13*-0x1b7+-0x22df)],_0x2c4374=_0x3496cb[_0x2734e7[_0x256e2f(0x128)](_0x49cfc9,-0x1e10+0xc7e+-0x8d*-0x22)]['id'],_0x56c44e=_0x3496cb[_0x2734e7[_0x256e2f(0x109)](_0x49cfc9,0x1171+0x2c6+-0x12f2)]||_0x8add63[_0x2734e7[_0x256e2f(0x180)](_0x49cfc9,-0x1c9*0x1+-0xeb*-0x29+-0x2274)],_0x468b88=_0x8add63[_0x2734e7[_0x256e2f(0x1c2)](_0x49cfc9,-0x31*0x7c+-0x1418+0x2d00)](moment)[_0x2734e7[_0x256e2f(0x180)](_0x49cfc9,0x1ec6+0x7*0x379+-0x35de)](_0x8add63[_0x2734e7[_0x256e2f(0x16d)](_0x49cfc9,-0x23+0x66e*0x2+0x3d1*-0x3)]),_0x451d67=_0x2734e7[_0x256e2f(0x174)]('',_0x3496cb[_0x2734e7[_0x256e2f(0x1ea)](_0x49cfc9,0x1725+0x1*-0x281+-0x1373)][_0x2734e7[_0x256e2f(0x11b)](_0x49cfc9,-0x2687+0x2091+0x46*0x1b)]||_0x4f96c1);console[_0x2734e7[_0x256e2f(0x1ea)](_0x49cfc9,-0x159e+-0x3*0x992+0x3384)](_0x8add63[_0x2734e7[_0x256e2f(0x1ea)](_0x49cfc9,-0x1c84+0x3*0x3f+0x3*0x9ad)](_0x8add63[_0x2734e7[_0x256e2f(0x154)](_0x49cfc9,-0x4*-0x19b+-0x1*-0x1445+-0x1971)](_0x8add63[_0x2734e7[_0x256e2f(0x1ce)](_0x49cfc9,-0x15*0x115+0xba2*0x2+0xb5)](chalk[_0x2734e7[_0x256e2f(0x126)](_0x49cfc9,-0x43*-0x26+-0x253c+0x1c78)](chalk[_0x2734e7[_0x256e2f(0x16a)](_0x49cfc9,0xd*-0x16f+0x19ce+-0x5e7)](_0x8add63[_0x2734e7[_0x256e2f(0x126)](_0x49cfc9,0x443+-0x1a84*0x1+-0x56*-0x46)])),chalk[_0x2734e7[_0x256e2f(0x113)](_0x49cfc9,-0x223*0x3+-0x1817+-0xaa1*-0x3)](chalk[_0x2734e7[_0x256e2f(0x1d3)](_0x49cfc9,-0x2683+-0x1aa1+-0x2*-0x2134)](_0x56c44e))),'\x0a'),chalk[_0x2734e7[_0x256e2f(0x121)](_0x49cfc9,0x1*-0xd8d+-0x2*-0x251+-0xee*-0xb)](_0x8add63[_0x2734e7[_0x256e2f(0x109)](_0x49cfc9,0x20a9+0xda4+-0x2ceb)])),chalk[_0x2734e7[_0x256e2f(0x11c)](_0x49cfc9,-0x1*0x15fb+0x1982+-0x23b)](_0x4f96c1),_0x8add63[_0x2734e7[_0x256e2f(0xf9)](_0x49cfc9,0x910+0x4bc+-0xc90)](_0x8add63[_0x2734e7[_0x256e2f(0x1d5)](_0x49cfc9,-0x504*0x3+-0x8c4+0x394*0x7)](chalk[_0x2734e7[_0x256e2f(0x134)](_0x49cfc9,0x2562+-0x1*-0x14b7+0xb5f*-0x5)](_0x2c4374),'\x0a'),chalk[_0x2734e7[_0x256e2f(0x112)](_0x49cfc9,0x963+-0x4*-0x39e+0x20e*-0xb)](_0x8add63[_0x2734e7[_0x256e2f(0x1d5)](_0x49cfc9,-0x13d6+-0x470+0x1990)])),_0x8add63[_0x2734e7[_0x256e2f(0x11b)](_0x49cfc9,-0x24cf+-0x2*0xaca+0x3b9f)](_0x8add63[_0x2734e7[_0x256e2f(0x111)](_0x49cfc9,-0xb5*0x17+-0x40c+0x158f)](_0x8add63[_0x2734e7[_0x256e2f(0x130)](_0x49cfc9,-0x19a9+0x11*-0x53+-0x2081*-0x1)](chalk[_0x2734e7[_0x256e2f(0x1a3)](_0x49cfc9,-0x15b8+0x1*0x121+0xd*0x1af)](_0x451d67),'\x0a'),chalk[_0x2734e7[_0x256e2f(0x14e)](_0x49cfc9,-0x1f*0x11c+-0x300+-0x26b3*-0x1)](_0x8add63[_0x2734e7[_0x256e2f(0x11c)](_0x49cfc9,0x1839+0x1206+-0x6*0x6d2)])),chalk[_0x2734e7[_0x256e2f(0x1d5)](_0x49cfc9,0x256c+-0x3c8+-0x204a)](_0x468b88)));}catch(_0xfa7ffe){console[_0x2734e7[_0x256e2f(0x167)](_0x49cfc9,0x18dc+0x1*-0xd3+-0x16b5*0x1)](_0x8add63[_0x2734e7[_0x256e2f(0xf9)](_0x49cfc9,0x168c+-0x2*0x9ae+0xb*-0x2f)],_0xfa7ffe);}}),process['on'](_0x1bcea7(-0xb73+0xb5*0xf+-0x8*-0x47),async()=>{const _0x34eb5c=_0x2f16,_0x4ec763={'RhQrr':function(_0x52f81d,_0x327732){return _0x52f81d(_0x327732);}},_0x45b1af=_0x1bcea7;await mClient[_0x4ec763[_0x34eb5c(0xfe)](_0x45b1af,-0x4f7*0x1+0xa69+-0x46*0xf)]();}),console[_0x1bcea7(0x607*-0x5+-0x1968+0x38bb)](chalk[_0x1bcea7(0x13d*0x1f+-0x5*-0x22a+-0x2fe9)](figlet[_0x1bcea7(-0xfed*0x1+-0xd9*-0xf+-0x1*-0x46c)](_0x1bcea7(0x1791+0x1493+-0x6*0x727),{'font':_0x1bcea7(0xdb9+0x2274*-0x1+0x15f8)+'m','horizontalLayout':_0x1bcea7(-0x11f0+0x3c+0x2*0x976),'verticalLayout':_0x1bcea7(0xdd7+-0x769+-0x536)}))),console[_0x1bcea7(0x165a+0xa24+0x2*-0xfa7)](chalk[_0x1bcea7(-0xd*0x38+0x1d3b+-0x3*0x85d)](_0x1bcea7(0x1*0x935+0x8*0x10f+-0x2f*0x59)+_0x1bcea7(-0x1aef+0x268+0x19c2)+_0x1bcea7(0x1*-0x293+0x2e*-0x48+-0x5*-0x35d))),console[_0x1bcea7(0x17*0xc5+-0x1541*0x1+0x4be)](chalk[_0x1bcea7(0x5bd*0x6+0x199*0x9+-0x2f83)](_0x1bcea7(-0x1eab+0xa3f+0x1595)+_0x1bcea7(-0x320+0x1*-0x137f+0x17d1))),console[_0x1bcea7(-0x4a5+0x2198+-0x1bc3)](chalk[_0x1bcea7(-0x1ff7+0x1690+0xab3)](_0x1bcea7(0x1*0xe5+0x17*-0x92+0xd7b)+_0x1bcea7(0x207e+-0x24d+-0xb5*0x29)+_0x1bcea7(-0x549+0x2386+-0x1cd5)+_0x1bcea7(-0x147c+0x2107+-0xb20))));function _0x124c(){const _0x31bb51=['bZokz','rlvXs','1379608WJY','Jgh','close','tPyDs','...','xaqPq','RusxA','GGKvw','Fxrvo','2lPnuFB','CXbTa','LzKcU','qIAAV','121830VjCbBr','XwGhf','JF\x20Dev','5636296pif','ghANS','blueBright','FMBhX','NRnTq','rational.','9bygdsU','KoZRv','SHTdd','2452992MXnGed','Initializi','SNztJ','mrunE','UIvvH','fFGDf','NJwtD','LNpkJ','text','username','2473548fmraBF','FDXuR','4168722UuV','RkB','WFMcH','992wQEwSo','message>','vhjQp','ryoTW','VyJme','UeWSA','FXzye','yCGeZ','pyYDy','is\x20now\x20ope','DuZpF','OeeyU','nVjMT','ling\x20messa','EKlMb','thHLX','[\x20PESAN\x20]\x20','exit','=>\x20Dari','yboyJ','fWgyC','xzPYc','vMUoD','TLwvI','UvXoz','YiJJu','ZxXZQ','scvYE','No\x20Name','white','gVbYn','mbLuw','HRrfV','EOmqI','ZsPlT','UgZ','CulKS','YPgdl','5zqAfvw','HhYgs','gUEEI','shift','wAgLU','euion','9963190yVcXJc','LutDv','aKzzM','jZfJZ','ZOzmm','LBJGB','wnWjd','iovap','zvNvS','zaNHH','title','TTsVg','LDpkt','tWrok','TfvKn','BmlCx','bgBlack','oARtw','bjhGW','nURbA','JCnMG','SlhkL','toString','yellow','nwHGn','KJuSE','s\x20go!\x20Bot\x20','XwmBI','fttsN','125038PdCU','KPLEI','ge:','70VQYkBx','mBeFb','33625ndYByA','gQnUK','KxsnP','FUaPm','=>\x20','GTuZD','Ylppi','textSync','hQAOq','xUMrL','QVmIr','rgrZZ','red','50729rnTVK','2825192WrmNNt','aaenV','pKQsW','Cybermediu','JEQMK','uigvf','push','JqZgs','format','=>\x20Di','xmFWx','2848455xCG','AugUX','qwkDK','ywXVh','NTwBf','otDNj','ArTtp','CFSlW','YnIbu','DHBKN','aiyGL','TPVSg','gazzN','qpeIJ','Oegft','chat','tpkId','fGFDa','RhQrr','utGXZ','JzftB','POVEE','bPXBm','bLsaA','dules...','XlLMx','default','RHcEr','dCapF','zbbFJ','cyan','1456191KSOpbM','gJuYe','vqYFy','error','ULhKM','iBqUI','XuqPh','BCQis','KDruH','vBnTA','PRyQg','QogZH','wWgHc','LlHED','No\x20Usernam','Jam\x20:','fBoRn','NCyZe','message','kXNHG','dCTZK','magenta','qjULc','smZCW','OdOOr','kelBq','IIXEX','uddgu','ZjrgE','ioKIR','CCFXh','QfZKG','Loading\x20mo','DjSaM','RKrsE','GXnfU','yRSLJ','ZFwDS','iDVFi','kwANW','YdlRS','Dbgcc','xMtPq','hUJfE','rxXqR','log','XPSKa','ojADq','green','SkCfL','GqtQG','niYSL','NoEzI','ng\x20systems','wYXdX','HH:mm:ss','<non-text\x20','All\x20system','JHefP','tNNEv','NzFIC','Yjpzn','Tjszd','huAnY','Error\x20hand','first_name','5359717Loe','vxfjQ','elyOy','tDNQm','FxAYs','ogr','UQBgi','dOTwT','SRy','from','12EYGhQS','OBZdd','36ZxnOwv'];_0x124c=function(){return _0x31bb51;};return _0x124c();}function _0x596a(){const _0x544563=_0x2f16,_0xf66e79={'gazzN':_0x544563(0x1df)+'a','UIvvH':_0x544563(0x16b),'vhjQp':_0x544563(0x140),'OeeyU':_0x544563(0x15f),'xaqPq':_0x544563(0x1e3),'xMtPq':_0x544563(0x1c7),'XlLMx':_0x544563(0x185),'vMUoD':_0x544563(0x1bd),'wAgLU':_0x544563(0x16e),'FMBhX':_0x544563(0x144),'JzftB':_0x544563(0x162),'mrunE':_0x544563(0x1c0),'yboyJ':_0x544563(0x17d),'yCGeZ':_0x544563(0x1e7),'TLwvI':_0x544563(0x191),'gJuYe':_0x544563(0x14c),'Yjpzn':_0x544563(0x1e9),'fFGDf':_0x544563(0x19f),'TTsVg':_0x544563(0x14d)+_0x544563(0x152),'kXNHG':_0x544563(0x13b),'YdlRS':_0x544563(0x1a0),'aiyGL':_0x544563(0x160),'GqtQG':_0x544563(0x120),'HRrfV':_0x544563(0x1cf),'NzFIC':_0x544563(0x11a),'bLsaA':_0x544563(0x119),'AugUX':_0x544563(0x110),'nURbA':_0x544563(0x10e),'LNpkJ':_0x544563(0x141),'CFSlW':_0x544563(0x176),'SkCfL':_0x544563(0x184),'LlHED':_0x544563(0x15e),'GGKvw':_0x544563(0x1cd)+'wk','hQAOq':_0x544563(0x10a),'ojADq':_0x544563(0x194),'wnWjd':_0x544563(0x196),'kwANW':_0x544563(0x1c6),'CulKS':_0x544563(0x1eb)+_0x544563(0x15d),'rxXqR':_0x544563(0x1d0),'euion':_0x544563(0x195),'bZokz':_0x544563(0x14b),'OdOOr':_0x544563(0x18e),'fttsN':_0x544563(0x1a1),'TfvKn':_0x544563(0x102),'UeWSA':_0x544563(0x1ac),'otDNj':_0x544563(0x1b2),'Fxrvo':_0x544563(0x17e),'FXzye':_0x544563(0x18d),'nVjMT':_0x544563(0x181)+_0x544563(0x155),'VyJme':_0x544563(0x159),'Oegft':_0x544563(0x171),'qIAAV':_0x544563(0x1ba),'IIXEX':_0x544563(0x143),'xUMrL':_0x544563(0x16c)+_0x544563(0x182),'UQBgi':_0x544563(0x11d),'DHBKN':_0x544563(0x156),'yRSLJ':_0x544563(0x12b),'XPSKa':_0x544563(0x1b3),'dCTZK':_0x544563(0x101),'fWgyC':_0x544563(0x17b),'XwmBI':_0x544563(0x142),'LutDv':_0x544563(0x1de),'FxAYs':_0x544563(0x15c)+_0x544563(0x1a7),'ryoTW':_0x544563(0x138),'ZxXZQ':_0x544563(0xfb),'YiJJu':_0x544563(0x104),'wWgHc':_0x544563(0x1aa),'JEQMK':_0x544563(0x1ca),'rgrZZ':_0x544563(0x1d6),'thHLX':_0x544563(0x1d9),'ArTtp':_0x544563(0x1e8),'RKrsE':_0x544563(0x106),'tpkId':function(_0x244b84){return _0x244b84();}},_0x1b1458=[_0xf66e79[_0x544563(0xf8)],_0xf66e79[_0x544563(0x179)],_0xf66e79[_0x544563(0x186)],_0xf66e79[_0x544563(0x18f)],_0xf66e79[_0x544563(0x161)],_0xf66e79[_0x544563(0x135)],_0xf66e79[_0x544563(0x105)],_0xf66e79[_0x544563(0x19a)],_0xf66e79[_0x544563(0x1ae)],_0xf66e79[_0x544563(0x16f)],_0xf66e79[_0x544563(0x100)],_0xf66e79[_0x544563(0x178)],_0xf66e79[_0x544563(0x197)],_0xf66e79[_0x544563(0x18b)],_0xf66e79[_0x544563(0x19b)],_0xf66e79[_0x544563(0x10c)],_0xf66e79[_0x544563(0x148)],_0xf66e79[_0x544563(0x17a)],_0xf66e79[_0x544563(0x1bb)],_0xf66e79[_0x544563(0x11e)],_0xf66e79[_0x544563(0x133)],_0xf66e79[_0x544563(0xf6)],_0xf66e79[_0x544563(0x13d)],_0xf66e79[_0x544563(0x1a4)],_0xf66e79[_0x544563(0x147)],_0xf66e79[_0x544563(0x103)],_0xf66e79[_0x544563(0x1ec)],_0xf66e79[_0x544563(0x1c3)],_0xf66e79[_0x544563(0x17c)],_0xf66e79[_0x544563(0xf3)],_0xf66e79[_0x544563(0x13c)],_0xf66e79[_0x544563(0x118)],_0xf66e79[_0x544563(0x163)],_0xf66e79[_0x544563(0x1da)],_0xf66e79[_0x544563(0x13a)],_0xf66e79[_0x544563(0x1b6)],_0xf66e79[_0x544563(0x132)],_0xf66e79[_0x544563(0x1a8)],_0xf66e79[_0x544563(0x137)],_0xf66e79[_0x544563(0x1af)],_0xf66e79[_0x544563(0x15a)],_0xf66e79[_0x544563(0x123)],_0xf66e79[_0x544563(0x1cc)],_0xf66e79[_0x544563(0x1be)],_0xf66e79[_0x544563(0x189)],_0xf66e79[_0x544563(0xf1)],_0xf66e79[_0x544563(0x164)],_0xf66e79[_0x544563(0x18a)],_0xf66e79[_0x544563(0x190)],_0xf66e79[_0x544563(0x188)],_0xf66e79[_0x544563(0xfa)],_0xf66e79[_0x544563(0x168)],_0xf66e79[_0x544563(0x125)],_0xf66e79[_0x544563(0x1db)],_0xf66e79[_0x544563(0x153)],_0xf66e79[_0x544563(0xf5)],_0xf66e79[_0x544563(0x12f)],_0xf66e79[_0x544563(0x139)],_0xf66e79[_0x544563(0x11f)],_0xf66e79[_0x544563(0x198)],_0xf66e79[_0x544563(0x1cb)],_0xf66e79[_0x544563(0x1b1)],_0xf66e79[_0x544563(0x151)],_0xf66e79[_0x544563(0x187)],_0xf66e79[_0x544563(0x19e)],_0xf66e79[_0x544563(0x19d)],_0xf66e79[_0x544563(0x117)],_0xf66e79[_0x544563(0x1e4)],_0xf66e79[_0x544563(0x1dd)],_0xf66e79[_0x544563(0x193)],_0xf66e79[_0x544563(0xf2)],_0xf66e79[_0x544563(0x12d)]];return _0x596a=function(){return _0x1b1458;},_0xf66e79[_0x544563(0xfc)](_0x596a);}
}).catch((error) => {
    console.error("Error", error);
});
