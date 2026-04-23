const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const app = express();
const PORT = process.env.PORT || 3000;

// ========== قاعدة البيانات ==========
const db = new sqlite3.Database('nex.db');

db.run(`CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT UNIQUE,
    active BOOLEAN DEFAULT 0,
    plan TEXT DEFAULT 'normal',
    expires_at TEXT,
    activated_by TEXT,
    code TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS activation_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    plan TEXT DEFAULT 'normal',
    days INTEGER DEFAULT 30,
    used BOOLEAN DEFAULT 0,
    used_by TEXT,
    used_at TEXT,
    created_by TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS activation_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_name TEXT,
    user_id TEXT,
    user_name TEXT,
    days INTEGER,
    plan TEXT,
    code TEXT,
    status TEXT DEFAULT 'pending'
)`);

// ========== بوت ديسكورد ==========
const botToken = 'MTQ5Njc5NTA5MTQyMjE1MDcwNg.Gu5G2s.4F7VUDY7fy2p23BPfGiSV1AlEvS2PkSloXBgCc';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// توليد رمز عشوائي
function generateCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// إضافة أيام للتاريخ
function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result.toISOString();
}

// أوامر البوت
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const command = args[0].toLowerCase();

    // ========== أمر صنع كود ==========
    if (command === 'صنع' && args[1] && args[2]) {
        const days = parseInt(args[1]);
        const plan = args[2].toLowerCase();
        const code = generateCode();
        
        if (isNaN(days) || days <= 0) {
            return message.reply('❌ يرجى إدخال عدد أيام صحيح');
        }
        if (plan !== 'normal' && plan !== 'vip') {
            return message.reply('❌ الباقة إما normal أو vip');
        }
        
        db.run(`INSERT INTO activation_codes (code, plan, days, created_by) VALUES (?, ?, ?, ?)`,
            [code, plan, days, message.author.tag],
            async (err) => {
                if (err) {
                    return message.reply('❌ حدث خطأ في إنشاء الكود');
                }
                
                const embed = new EmbedBuilder()
                    .setColor(0x00ff00)
                    .setTitle('✅ تم إنشاء كود جديد')
                    .addFields(
                        { name: '🔑 الكود', value: `\`${code}\``, inline: true },
                        { name: '📅 المدة', value: `${days} يوم`, inline: true },
                        { name: '🎁 الباقة', value: plan === 'vip' ? 'VIP' : 'عادية', inline: true }
                    )
                    .setFooter({ text: `بواسطة: ${message.author.tag}` })
                    .setTimestamp();
                
                await message.reply({ embeds: [embed] });
            }
        );
    }

    // ========== أمر التحقق من كود ==========
    else if (command === 'تحقق' && args[1]) {
        const code = args[1].toUpperCase();
        
        db.get(`SELECT * FROM activation_codes WHERE code = ?`, [code], async (err, row) => {
            if (err || !row) {
                return message.reply('❌ الكود غير موجود');
            }
            if (row.used) {
                return message.reply(`❌ هذا الكود مستخدم من قبل ${row.used_by}`);
            }
            
            const embed = new EmbedBuilder()
                .setColor(0x00ff00)
                .setTitle('✅ كود صالح')
                .addFields(
                    { name: '🎁 الباقة', value: row.plan === 'vip' ? 'VIP' : 'عادية', inline: true },
                    { name: '📅 المدة', value: `${row.days} يوم`, inline: true }
                );
            
            await message.reply({ embeds: [embed] });
        });
    }

    // ========== أمر تفعيل كود للمستخدم ==========
    else if (command === 'تفعيل' && args[1] && args[2]) {
        const code = args[1].toUpperCase();
        const targetUserId = args[2];
        
        db.get(`SELECT * FROM activation_codes WHERE code = ?`, [code], async (err, codeRow) => {
            if (err || !codeRow) {
                return message.reply('❌ الكود غير موجود');
            }
            if (codeRow.used) {
                return message.reply(`❌ الكود مستخدم من قبل`);
            }
            
            const expiresAt = addDays(new Date(), codeRow.days);
            
            db.run(`INSERT OR REPLACE INTO subscriptions (user_id, active, plan, expires_at, activated_by, code) 
                    VALUES (?, 1, ?, ?, ?, ?)`,
                [targetUserId, codeRow.plan, expiresAt, message.author.tag, code],
                async (err2) => {
                    if (err2) {
                        return message.reply('❌ خطأ في التفعيل');
                    }
                    
                    db.run(`UPDATE activation_codes SET used = 1, used_by = ?, used_at = ? WHERE code = ?`,
                        [targetUserId, new Date().toISOString(), code]);
                    
                    const embed = new EmbedBuilder()
                        .setColor(0x00ff00)
                        .setTitle('✅ تم التفعيل بنجاح')
                        .addFields(
                            { name: '👤 المستخدم', value: `<@${targetUserId}>`, inline: true },
                            { name: '🎁 الباقة', value: codeRow.plan === 'vip' ? 'VIP' : 'عادية', inline: true },
                            { name: '📅 المدة', value: `${codeRow.days} يوم`, inline: true }
                        );
                    
                    await message.reply({ embeds: [embed] });
                    
                    // محاولة إرسال رسالة خاصة للمستخدم
                    try {
                        const user = await client.users.fetch(targetUserId);
                        await user.send(`🎉 تم تفعيل اشتراكك بنجاح!\n📅 المدة: ${codeRow.days} يوم\n🎁 الباقة: ${codeRow.plan === 'vip' ? 'VIP' : 'عادية'}`);
                    } catch(e) {}
                });
        });
    }

    // ========== أمر طلب تفعيل من المشرف ==========
    else if (command === 'طلب' && args[1] && args[2] && args[3]) {
        const adminName = args[1];
        const userId = args[2];
        const days = parseInt(args[3]);
        const plan = args[4] || 'normal';
        
        const code = generateCode();
        
        db.run(`INSERT INTO activation_requests (admin_name, user_id, user_name, days, plan, code) 
                VALUES (?, ?, ?, ?, ?, ?)`,
            [adminName, userId, `user_${userId}`, days, plan, code],
            async (err) => {
                if (err) {
                    return message.reply('❌ حدث خطأ');
                }
                
                const embed = new EmbedBuilder()
                    .setColor(0xffa500)
                    .setTitle('📋 طلب تفعيل جديد')
                    .addFields(
                        { name: '👤 المرسل', value: adminName, inline: true },
                        { name: '👥 المستخدم', value: `<@${userId}>`, inline: true },
                        { name: '📅 المدة', value: `${days} يوم`, inline: true },
                        { name: '🎁 الباقة', value: plan === 'vip' ? 'VIP' : 'عادية', inline: true },
                        { name: '🔑 الكود', value: `\`${code}\``, inline: true }
                    )
                    .setFooter({ text: 'انتظر موافقة المدير' });
                
                await message.reply({ embeds: [embed] });
            });
    }

    // ========== أمر البحث عن مستخدم ==========
    else if (command === 'بحث' && args[1]) {
        const userId = args[1];
        
        db.get(`SELECT * FROM subscriptions WHERE user_id = ?`, [userId], async (err, row) => {
            if (err) {
                return message.reply('❌ خطأ في البحث');
            }
            if (!row) {
                return message.reply(`❌ لا يوجد اشتراك للمستخدم <@${userId}>`);
            }
            
            const embed = new EmbedBuilder()
                .setColor(row.active ? 0x00ff00 : 0xff0000)
                .setTitle(`📋 معلومات اشتراك`)
                .addFields(
                    { name: '👤 المستخدم', value: `<@${userId}>`, inline: true },
                    { name: '✅ الحالة', value: row.active ? 'مفعل' : 'غير مفعل', inline: true },
                    { name: '🎁 الباقة', value: row.plan === 'vip' ? 'VIP' : 'عادية', inline: true },
                    { name: '📅 ينتهي في', value: row.expires_at || 'غير محدد', inline: true }
                )
                .setTimestamp();
            
            await message.reply({ embeds: [embed] });
        });
    }
    
    // ========== مساعدة ==========
    else if (command === 'مساعدة') {
        const embed = new EmbedBuilder()
            .setColor(0xff004c)
            .setTitle('🤖 أوامر البوت')
            .addFields(
                { name: '!صنع [مدة] [نوع]', value: 'صنع كود جديد\nمثال: `!صنع 30 vip`', inline: false },
                { name: '!تحقق [كود]', value: 'التحقق من صلاحية كود', inline: false },
                { name: '!تفعيل [كود] [آيدي]', value: 'تفعيل كود لمستخدم', inline: false },
                { name: '!طلب [مرسل] [آيدي] [مدة]', value: 'طلب تفعيل', inline: false },
                { name: '!بحث [آيدي]', value: 'البحث عن اشتراك مستخدم', inline: false }
            )
            .setFooter({ text: 'NEX Bot - بواسطة الشمري' });
        
        await message.reply({ embeds: [embed] });
    }
});

client.on('ready', () => {
    console.log(`✅ بوت ديسكورد متصل: ${client.user.tag}`);
    client.user.setActivity('NEX | !مساعدة', { type: 3 }); // Watching
});

// تشغيل البوت
client.login(botToken).catch(e => {
    console.error('❌ فشل اتصال البوت:', e.message);
});

// ========== إعدادات Express ==========
app.use(express.json());
app.use(express.static('public'));

// API Routes
app.get('/api/subscription/:userId', (req, res) => {
    const userId = req.params.userId;
    db.get(`SELECT active, plan, expires_at FROM subscriptions WHERE user_id = ?`, [userId], (err, row) => {
        if (err || !row) {
            return res.json({ active: false });
        }
        res.json({ active: row.active === 1, plan: row.plan, expires_at: row.expires_at });
    });
});

app.post('/api/activate-with-code', (req, res) => {
    const { code, user_id } = req.body;
    
    db.get(`SELECT * FROM activation_codes WHERE code = ? AND used = 0`, [code], (err, codeRow) => {
        if (err || !codeRow) {
            return res.json({ success: false, error: 'رمز غير صالح' });
        }
        
        const expiresAt = addDays(new Date(), codeRow.days);
        
        db.run(`INSERT OR REPLACE INTO subscriptions (user_id, active, plan, expires_at, activated_by, code) 
                VALUES (?, 1, ?, ?, ?, ?)`,
            [user_id, codeRow.plan, expiresAt, 'system', code],
            (err2) => {
                if (err2) {
                    return res.json({ success: false, error: 'خطأ في التفعيل' });
                }
                
                db.run(`UPDATE activation_codes SET used = 1, used_by = ?, used_at = ? WHERE code = ?`,
                    [user_id, new Date().toISOString(), code]);
                
                res.json({ success: true, plan: codeRow.plan, days: codeRow.days });
            });
    });
});

app.post('/api/accept-request', (req, res) => {
    const { request_id, user_id, days, plan, code } = req.body;
    
    const expiresAt = addDays(new Date(), days);
    
    db.run(`INSERT OR REPLACE INTO subscriptions (user_id, active, plan, expires_at, activated_by, code) 
            VALUES (?, 1, ?, ?, ?, ?)`,
        [user_id, plan, expiresAt, 'admin', code],
        (err) => {
            if (err) {
                return res.json({ success: false });
            }
            db.run(`UPDATE activation_requests SET status = 'approved' WHERE id = ?`, [request_id]);
            res.json({ success: true });
        });
});

app.post('/api/reject-request', (req, res) => {
    const { request_id } = req.body;
    db.run(`UPDATE activation_requests SET status = 'rejected' WHERE id = ?`, [request_id]);
    res.json({ success: true });
});

app.get('/api/activation-requests', (req, res) => {
    db.all(`SELECT * FROM activation_requests WHERE status = 'pending'`, [], (err, rows) => {
        res.json({ requests: rows || [] });
    });
});

// تشغيل السيرفر
app.listen(PORT, () => {
    console.log(`🚀 السيرفر شغال على http://localhost:${PORT}`);
});