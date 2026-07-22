import telebot
from telebot.types import InlineKeyboardMarkup, InlineKeyboardButton
import time
import schedule
import threading

# ==========================================
# الإعدادات الأساسية (تم إدخال بياناتك بنجاح)
# ==========================================
TOKEN = "8787496108:AAFnPOzep_lawLvsJuBoNrD9Owltx6-zzfo"
CHAT_ID = "-1001920070532" # جروب: سلة شوب sallanet ©

# ⚠️ هام: ضع رابط الصورة أو اللوجو الخاص ببراند Sallanet هنا بين علامتي التنصيص
MEDIA_URL = "https://example.com/your-sallanet-image.jpg" 

bot = telebot.TeleBot(TOKEN)
last_message_id = None

def send_promotional_message():
    global last_message_id

    # حذف الرسالة القديمة إن وجدت
    if last_message_id:
        try:
            bot.delete_message(CHAT_ID, last_message_id)
            print("🗑️ تم حذف الرسالة السابقة.")
        except Exception as e:
            print(f"⚠️ لم أتمكن من حذف الرسالة السابقة: {e}")

    # إعداد الأزرار
    markup = InlineKeyboardMarkup(row_width=1)
    btn1 = InlineKeyboardButton("⭐️ شحن نجوم وتليجرام المميز ⭐️", url="https://telegram.salla-shop.com")
    btn2 = InlineKeyboardButton("🛍️ اكتشف مول Pi Web3 🛍️", url="https://Mall.salla-shop.com")
    markup.add(btn1, btn2)

    # النص التسويقي الجذاب
    text = """
🌟 <b>اشحن رصيدك الآن بثوانٍ معدودة!</b> 🌟

هل تبحث عن طريقة مضمونة وسريعة لشحن <b>نجوم تليجرام</b> أو الاشتراك في <b>تليجرام المميز (Premium)</b>؟ 🚀

✅ <b>تطبيق معتمد وفوري:</b> مرتبط بشبكة تليجرام مباشرة لضمان وصول رصيدك في نفس اللحظة.
💳 <b>طرق دفع مرنة:</b> ندعم كافة طرق الدفع المصرية والعالمية لتناسب الجميع.

✨ <i>ضمان، سرعة، وموثوقية عالية مع براند Sallanet!</i> 👇
    """

    # إرسال الصورة مع النص والأزرار
    try:
        msg = bot.send_photo(
            CHAT_ID,
            photo=MEDIA_URL,
            caption=text,
            parse_mode='HTML',
            reply_markup=markup
        )
        last_message_id = msg.message_id
        print(f"✅ تم إرسال الرسالة بنجاح، معرف الرسالة: {last_message_id}")
    except Exception as e:
        print(f"❌ حدث خطأ أثناء الإرسال: {e}")

# جدولة المهمة لتحدث كل 24 ساعة
schedule.every(24).hours.do(send_promotional_message)

def run_scheduler():
    while True:
        schedule.run_pending()
        time.sleep(1)

# تشغيل الإرسال فوراً عند تشغيل السكريبت لأول مرة
send_promotional_message()

# تشغيل الجدولة في الخلفية
threading.Thread(target=run_scheduler, daemon=True).start()

print("🤖 البوت يعمل الآن ويراقب الجدولة...")
bot.infinity_polling()
