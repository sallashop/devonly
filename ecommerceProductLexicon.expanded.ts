/**
 * Extended ecommerce product lexicon for Salla Shop AI Chatbot.
 *
 * Purpose:
 * - Help the backend understand product families/categories, synonyms, brands, and common Arabic/English misspellings.
 * - This file is NOT a product database. Real products must always be fetched from Supabase tables.
 * - Keep product names in the database; keep product types, families, brands, synonyms, and exclusions here.
 */

export type EcommerceProductFamily = {
  id: string;
  labelAr: string;
  labelEn: string;
  terms: string[];
  strictQueryTerms?: string[];
  includeWords?: string[];
  excludeWords?: string[];
  strongExcludeWords?: string[];
  categoryHints?: string[];
  service?: boolean;
};

export const ECOMMERCE_GENERIC_TYPE_WORDS = [
  "منتج", "منتجات", "سلعة", "سلع", "حاجة", "حاجه", "قطعة", "قطعه", "نوع", "انواع", "أنواع",
  "متوفر", "متوفرة", "متوفره", "متاح", "متاحة", "متاحه", "موجود", "موجودة", "موجوده",
  "سعر", "اسعار", "أسعار", "بكام", "بكم", "كام", "كم", "ارخص", "أرخص", "اغلى", "أغلى", "افضل", "أفضل",
  "product", "products", "item", "items", "goods", "available", "availability", "price", "prices", "cheap", "cheapest", "best",
];

export const ECOMMERCE_PRODUCT_TYPE_WORDS = [
  // Electronics / phones
  "موبايل", "موبايلات", "موبيل", "موبيلات", "هاتف", "هواتف", "تليفون", "تليفونات", "جوال", "جوالات",
  "شاشة", "شاشه", "شاشات", "تلفزيون", "تليفزيون", "سمارت", "smart tv", "tv", "television", "screen", "monitor",
  "لابتوب", "لاب توب", "كمبيوتر", "حاسب", "تابلت", "ايباد", "راوتر", "كاميرا", "كاميرات", "بروجيكتور",
  "سماعة", "سماعات", "هاند فري", "ايربودز", "اير بودز", "مايك", "ميكروفون", "سبیکر", "سبيكر",
  "شاحن", "شواحن", "كابل", "كابلات", "وصلة", "وصلات", "باور بانك", "بور بانك", "جراب", "اسكرينة", "سكرينة", "حامل", "ريموت",
  "mobile", "mobiles", "phone", "phones", "smartphone", "smartphones", "laptop", "tablet", "computer", "camera", "charger", "cable", "case", "cover", "headset", "headphones", "earbuds", "speaker", "powerbank", "power bank",

  // Supermarket / grocery
  "شاي", "شاى", "قهوة", "قهوه", "نسكافيه", "سكر", "ارز", "أرز", "مكرونة", "مكرونه", "زيت", "سمنة", "سمنه", "دقيق", "ملح", "بهارات", "توابل", "صلصة", "صلصه", "عسل", "مربى", "مربي", "بسکويت", "بسكويت", "شوكولاته", "شيكولاته", "حليب", "لبن", "مياه", "ماء", "عصير", "مشروبات", "معلبات", "منظفات", "مسحوق", "صابون", "شامبو",
  "tea", "coffee", "sugar", "rice", "pasta", "oil", "flour", "salt", "spices", "sauce", "honey", "jam", "biscuits", "chocolate", "milk", "water", "juice", "drinks", "detergent", "soap", "shampoo",

  // Home / kitchen
  "غلاية", "غلايه", "غلايات", "خلاط", "كبة", "كبه", "مفرمة", "مفرمه", "ميكروويف", "فرن", "بوتاجاز", "ثلاجة", "ثلاجه", "ديب فريزر", "غسالة", "غساله", "مروحة", "مروحه", "دفاية", "دفايه", "مكنسة", "مكنسه", "مكواة", "مكواه", "طقم", "حلل", "حلة", "حله", "طاسة", "طاسه", "مقلاة", "مقلاه", "كوب", "مج", "طبق", "اطباق", "أطباق", "معلقة", "ملعقة", "شوكة", "سكينة",
  "kettle", "blender", "chopper", "microwave", "oven", "stove", "fridge", "refrigerator", "washer", "washing machine", "fan", "heater", "vacuum", "iron", "cookware", "pan", "pot", "cup", "mug", "plate",

  // Fashion / personal
  "ملابس", "لبس", "تيشيرت", "تشيرت", "قميص", "بنطلون", "فستان", "عباية", "عبايه", "حذاء", "جزمة", "جزمه", "كوتشي", "شنطة", "شنطه", "حقيبة", "حقيبه", "ساعة", "ساعه", "نظارة", "نضارة", "عطر", "برفان", "ميكب", "مكياج", "كريم", "عناية", "عنايه", "بشرة", "بشره", "شعر",
  "clothes", "fashion", "shirt", "tshirt", "pants", "dress", "shoes", "sneakers", "bag", "watch", "glasses", "perfume", "makeup", "cream", "skincare", "haircare",

  // Books / stationery / sports / kids
  "كتاب", "كتب", "كراسة", "كراسه", "كشكول", "قلم", "اقلام", "أقلام", "مكتب", "مكتبة", "مكتبه", "ادوات مكتبية", "أدوات مكتبية",
  "كرة", "كوره", "رياضة", "رياضه", "دمبل", "مات", "دراجة", "دراجه", "لعبة", "لعبه", "العاب", "ألعاب", "اطفال", "أطفال", "بيبي", "رضع",
  "book", "books", "notebook", "pen", "stationery", "office", "sports", "ball", "toys", "kids", "baby",

  // Services
  "خدمة", "خدمه", "خدمات", "منتج خدمي", "منتجات خدمية", "تصميم", "برمجة", "برمجه", "استشارة", "استشاره", "صيانة", "صيانه", "تسويق", "اعلان", "إعلان", "دورة", "دوره", "كورس", "ترجمة", "ترجمه", "كتابة", "كتابه",
  "service", "services", "design", "programming", "consultation", "maintenance", "marketing", "course", "translation", "writing",
];

export const ECOMMERCE_PRODUCT_BRAND_GROUPS = [
  ["سامسونج", "السامسونج", "samsung", "galaxy", "جالكسي", "جالاكسي"],
  ["اوبو", "أوبو", "oppo"],
  ["شاومي", "شياومي", "xiaomi", "mi", "redmi", "ريدمي", "بوكو", "poco"],
  ["ايفون", "ايفونه", "آيفون", "iphone", "apple", "ابل", "أبل"],
  ["انفنكس", "انفنيكس", "infinix"],
  ["ريلمي", "realme"],
  ["تكنو", "tecno"],
  ["هونر", "honor"],
  ["هواوي", "huawei"],
  ["نوكيا", "nokia"],
  ["لينوفو", "lenovo"],
  ["اتش بي", "hp", "hewlett packard"],
  ["ديل", "dell"],
  ["اسوس", "asus"],
  ["ايسر", "acer"],
  ["ال جي", "إل جي", "lg"],
  ["توشيبا", "toshiba"],
  ["سوني", "sony"],
  ["شارب", "sharp"],
  ["باناسونيك", "panasonic"],
  ["فريش", "fresh"],
  ["تورنيدو", "tornado"],
  ["براون", "braun"],
  ["فيليبس", "philips"],
  ["تيفال", "tefal"],
  ["بوش", "bosch"],
  ["مولينكس", "moulinex"],
  ["اريستون", "ariston"],
  ["وايت بوينت", "white point"],
  ["العروسة", "العروسه", "el arousa", "elarosa", "el-arousa"],
  ["احمد تي", "أحمد تي", "ahmad tea", "ahmed tea"],
  ["ليبتون", "lipton"],
  ["نسكافيه", "nescafe"],
  ["بروك بوند", "brook bond"],
  ["العابد", "elabed"],
  ["جهينة", "جهينه", "juhayna"],
  ["المراعي", "almarai"],
  ["دانون", "danone"],
  ["بيبسي", "pepsi"],
  ["كوكاكولا", "كوكا كولا", "coca cola", "coke"],
  ["اريال", "arial"],
  ["برسيل", "persil"],
  ["تايد", "tide"],
  ["داوني", "downy"],
  ["ديتول", "dettol"],
  ["نيفيا", "nivea"],
  ["دوف", "dove"],
  ["لوريال", "loreal", "l'oreal"],
  ["اديداس", "adidas"],
  ["نايكي", "nike"],
  ["بوما", "puma"],
];

export const ECOMMERCE_PRODUCT_BRAND_WORDS = Array.from(new Set(ECOMMERCE_PRODUCT_BRAND_GROUPS.flat()));

export const ECOMMERCE_PRODUCT_SYNONYMS: Record<string, string[]> = {
  // Phones
  "موبايل": ["موبيل", "موبايلات", "هاتف", "هواتف", "تليفون", "جوال", "mobile", "phone", "smartphone"],
  "موبايلات": ["موبايل", "موبيل", "هواتف", "تليفونات", "جوالات", "mobiles", "phones", "smartphones"],
  "هاتف": ["موبايل", "تليفون", "جوال", "phone", "mobile", "smartphone"],
  "تليفون": ["موبايل", "هاتف", "جوال", "phone"],
  "جوال": ["موبايل", "هاتف", "mobile", "phone"],
  "سامسونج": ["samsung", "جالكسي", "galaxy", "السامسونج"],
  "samsung": ["سامسونج", "جالكسي", "galaxy"],
  "اوبو": ["oppo", "أوبو"],
  "oppo": ["اوبو", "أوبو"],
  "شاومي": ["xiaomi", "redmi", "ريدمي", "mi", "poco", "بوكو"],
  "xiaomi": ["شاومي", "redmi", "ريدمي", "poco"],
  "ايفون": ["iphone", "apple", "ابل", "أبل"],
  "iphone": ["ايفون", "آيفون", "apple"],

  // Screens and accessories
  "شاشة": ["شاشه", "شاشات", "تلفزيون", "تليفزيون", "smart tv", "tv", "screen", "monitor"],
  "شاشه": ["شاشة", "شاشات", "تلفزيون", "smart tv", "screen"],
  "smart tv": ["شاشة", "شاشه", "تلفزيون", "تليفزيون", "tv"],
  "سماعة": ["سماعات", "هاند فري", "ايربودز", "earbuds", "headphones", "headset"],
  "شاحن": ["شواحن", "charger", "adapter", "ادابتور"],
  "كابل": ["كابلات", "وصلة", "وصله", "cable", "wire"],
  "جراب": ["كفر", "cover", "case"],
  "اسكرينة": ["سكرينة", "سكرينه", "screen protector", "protector"],

  // Supermarket
  "شاي": ["شاى", "tea"],
  "شاى": ["شاي", "tea"],
  "tea": ["شاي", "شاى"],
  "العروسة": ["العروسه", "el arousa", "elarosa", "el-arousa"],
  "العروسه": ["العروسة", "el arousa", "elarosa", "el-arousa"],
  "احمد تي": ["أحمد تي", "ahmad tea", "ahmed tea"],
  "قهوة": ["قهوه", "coffee"],
  "قهوه": ["قهوة", "coffee"],
  "سكر": ["sugar"],
  "ارز": ["أرز", "rice"],
  "مكرونة": ["مكرونه", "pasta"],
  "زيت": ["oil"],
  "سمنة": ["سمنه", "ghee"],
  "بهارات": ["توابل", "spices"],
  "منظفات": ["منظف", "مسحوق", "detergent", "cleaner"],

  // Home
  "غلاية": ["غلايه", "غلايات", "kettle", "electric kettle"],
  "غلايه": ["غلاية", "غلايات", "kettle"],
  "خلاط": ["blender"],
  "كبة": ["كبه", "chopper"],
  "مفرمة": ["مفرمه", "mincer", "chopper"],
  "ثلاجة": ["ثلاجه", "fridge", "refrigerator"],
  "غسالة": ["غساله", "washer", "washing machine"],
  "مروحة": ["مروحه", "fan"],
  "مكنسة": ["مكنسه", "vacuum"],
  "مكواة": ["مكواه", "iron"],

  // Fashion and services
  "ملابس": ["لبس", "clothes", "fashion"],
  "حذاء": ["جزمة", "جزمه", "كوتشي", "shoes", "sneakers"],
  "شنطة": ["شنطه", "حقيبة", "حقيبه", "bag"],
  "ساعة": ["ساعه", "watch"],
  "عطر": ["برفان", "perfume"],
  "خدمة": ["خدمه", "خدمات", "منتج خدمي", "service", "services"],
  "تصميم": ["design"],
  "برمجة": ["برمجه", "programming", "development"],
  "استشارة": ["استشاره", "consultation"],
  "صيانة": ["صيانه", "maintenance", "repair"],
};

export const ECOMMERCE_PRODUCT_FAMILIES: EcommerceProductFamily[] = [
  {
    id: "phones",
    labelAr: "موبايلات",
    labelEn: "Phones",
    terms: ["موبايل", "موبايلات", "موبيل", "هاتف", "هواتف", "تليفون", "تليفونات", "جوال", "جوالات", "mobile", "phone", "phones", "smartphone", "smartphones"],
    strictQueryTerms: ["موبايل", "موبايلات", "هاتف", "هواتف", "تليفون", "جوال", "mobile", "phone", "smartphone"],
    includeWords: ["موبايل", "هاتف", "تليفون", "جوال", "smartphone", "phone", "mobile", "android", "iphone", "galaxy"],
    excludeWords: ["سماعة", "سماعات", "شاحن", "شواحن", "كابل", "جراب", "كفر", "اسكرينة", "سكرينة", "حامل", "وصلة", "باور بانك", "ملحق", "اكسسوار", "headset", "earbuds", "charger", "cable", "case", "cover", "protector", "holder", "accessory", "powerbank", "vr"],
    categoryHints: ["موبايلات", "هواتف", "phones", "mobiles"],
  },
  {
    id: "phone_accessories",
    labelAr: "إكسسوارات موبايل",
    labelEn: "Phone Accessories",
    terms: ["اكسسوار", "اكسسوارات", "ملحق", "ملحقات", "جراب", "كفر", "اسكرينة", "سكرينة", "شاحن", "كابل", "وصلة", "حامل موبايل", "accessory", "case", "cover", "screen protector", "charger", "cable", "holder"],
    strictQueryTerms: ["جراب", "كفر", "اسكرينة", "سكرينة", "شاحن", "كابل", "وصلة", "ملحق", "اكسسوار", "case", "charger", "cable"],
    includeWords: ["جراب", "كفر", "اسكرينة", "شاحن", "كابل", "وصلة", "حامل", "accessory", "case", "charger", "cable"],
    excludeWords: [],
  },
  {
    id: "tv_screens",
    labelAr: "شاشات وتلفزيونات",
    labelEn: "TV Screens",
    terms: ["شاشة", "شاشه", "شاشات", "تلفزيون", "تليفزيون", "smart tv", "سمارت تي في", "tv", "television", "screen"],
    strictQueryTerms: ["شاشة", "شاشه", "تلفزيون", "تليفزيون", "smart tv", "tv"],
    includeWords: ["شاشة", "شاشه", "تلفزيون", "تليفزيون", "tv", "smart tv", "screen"],
    excludeWords: ["منظف", "تنظيف", "بخاخ", "حامل", "ريموت", "كابل", "hdmi", "وصلة", "اسكرينة", "screen cleaner", "cleaner", "remote", "stand", "holder", "cable"],
    categoryHints: ["شاشات", "تلفزيونات", "tv", "screens"],
  },
  {
    id: "audio",
    labelAr: "سماعات وصوتيات",
    labelEn: "Audio",
    terms: ["سماعة", "سماعات", "هاند فري", "ايربودز", "سبيكر", "سبیکر", "مايك", "ميكروفون", "earbuds", "headphones", "headset", "speaker", "microphone"],
    strictQueryTerms: ["سماعة", "سماعات", "هاند فري", "ايربودز", "سبيكر", "earbuds", "headphones", "headset", "speaker"],
    includeWords: ["سماعة", "هاند فري", "بلوتوث", "ايربودز", "سبيكر", "headset", "earbuds", "speaker", "bluetooth"],
    excludeWords: [],
  },
  {
    id: "computers",
    labelAr: "كمبيوتر ولابتوب",
    labelEn: "Computers",
    terms: ["لابتوب", "لاب توب", "كمبيوتر", "حاسب", "تابلت", "ايباد", "كيبورد", "ماوس", "هارد", "رام", "laptop", "computer", "pc", "tablet", "ipad", "keyboard", "mouse", "ssd", "ram"],
    strictQueryTerms: ["لابتوب", "لاب توب", "كمبيوتر", "تابلت", "laptop", "computer", "tablet"],
    includeWords: ["لابتوب", "كمبيوتر", "تابلت", "notebook", "laptop", "computer", "tablet"],
    excludeWords: ["شنطة", "حقيبة", "حامل", "كابل", "جراب", "bag", "case", "cable", "holder"],
  },
  {
    id: "tea",
    labelAr: "شاي",
    labelEn: "Tea",
    terms: ["شاي", "شاى", "tea", "العروسة", "العروسه", "احمد تي", "أحمد تي", "ليبتون", "lipton", "ahmad tea", "ahmed tea"],
    strictQueryTerms: ["شاي", "شاى", "tea"],
    includeWords: ["شاي", "شاى", "tea", "ناعم", "فتلة", "فتله", "سايب", "عروسة", "عروسه", "ليبتون", "احمد تي"],
    excludeWords: ["براد", "كوب", "مج", "غلاية", "غلايه", "مصفاة", "فلتر", "kettle", "cup", "mug", "strainer"],
    categoryHints: ["شاي", "مشروبات", "سوبر ماركت", "tea", "supermarket"],
  },
  {
    id: "coffee",
    labelAr: "قهوة ونسكافيه",
    labelEn: "Coffee",
    terms: ["قهوة", "قهوه", "بن", "نسكافيه", "كابتشينو", "coffee", "nescafe", "cappuccino", "espresso"],
    strictQueryTerms: ["قهوة", "قهوه", "نسكافيه", "coffee"],
    includeWords: ["قهوة", "بن", "نسكافيه", "coffee", "nescafe"],
    excludeWords: ["ماكينة", "مكنة", "مج", "كوب", "machine", "mug", "cup"],
  },
  {
    id: "supermarket",
    labelAr: "سوبر ماركت وبقالة",
    labelEn: "Supermarket",
    terms: ["سوبر ماركت", "بقالة", "بقاله", "مواد غذائية", "غذائي", "شاي", "سكر", "ارز", "مكرونة", "زيت", "سمنة", "دقيق", "معلبات", "مشروبات", "supermarket", "grocery", "food"],
    strictQueryTerms: ["سوبر ماركت", "بقالة", "بقاله", "مواد غذائية", "supermarket", "grocery"],
    includeWords: ["شاي", "سكر", "ارز", "مكرونة", "زيت", "سمنة", "دقيق", "معلبات", "مشروبات", "غذائي", "food", "grocery"],
    excludeWords: [],
  },
  {
    id: "detergents",
    labelAr: "منظفات",
    labelEn: "Detergents",
    terms: ["منظف", "منظفات", "مسحوق", "صابون", "مطهر", "كلور", "داوني", "برسيل", "اريال", "تايد", "detergent", "cleaner", "soap", "disinfectant"],
    strictQueryTerms: ["منظف", "منظفات", "مسحوق", "detergent", "cleaner"],
    includeWords: ["منظف", "مسحوق", "صابون", "مطهر", "detergent", "cleaner", "soap"],
    excludeWords: ["شاشة", "شاشه", "screen"],
  },
  {
    id: "kitchen_appliances",
    labelAr: "أجهزة مطبخ",
    labelEn: "Kitchen Appliances",
    terms: ["غلاية", "غلايه", "غلايات", "خلاط", "كبة", "كبه", "مفرمة", "ميكروويف", "قلاية", "قلايه", "kettle", "blender", "chopper", "microwave", "air fryer"],
    strictQueryTerms: ["غلاية", "غلايه", "خلاط", "كبة", "مفرمة", "ميكروويف", "kettle", "blender"],
    includeWords: ["غلاية", "خلاط", "كبة", "مفرمة", "ميكروويف", "kettle", "blender"],
    excludeWords: ["شاي", "قهوة", "tea", "coffee"],
  },
  {
    id: "home_appliances",
    labelAr: "أجهزة منزلية",
    labelEn: "Home Appliances",
    terms: ["ثلاجة", "غسالة", "بوتاجاز", "فرن", "مروحة", "دفاية", "مكنسة", "مكواة", "تكييف", "fridge", "washer", "oven", "fan", "heater", "vacuum", "iron", "air conditioner"],
    strictQueryTerms: ["ثلاجة", "غسالة", "بوتاجاز", "مروحة", "مكنسة", "تكييف", "fridge", "washer", "fan"],
    includeWords: ["ثلاجة", "غسالة", "مروحة", "مكنسة", "تكييف", "appliance"],
    excludeWords: [],
  },
  {
    id: "cookware",
    labelAr: "أدوات منزلية ومطبخ",
    labelEn: "Cookware & Homeware",
    terms: ["طقم", "حلل", "حلة", "طاسة", "مقلاة", "طبق", "اطباق", "كوب", "مج", "ملعقة", "شوكة", "سكينة", "cookware", "pan", "pot", "plate", "cup", "mug"],
    strictQueryTerms: ["طقم", "حلل", "حلة", "طاسة", "طبق", "كوب", "مج", "cookware", "pan", "pot"],
    includeWords: ["حلل", "طاسة", "طبق", "كوب", "مطبخ", "cookware", "pan", "pot"],
    excludeWords: [],
  },
  {
    id: "fashion",
    labelAr: "ملابس وموضة",
    labelEn: "Fashion",
    terms: ["ملابس", "لبس", "تيشيرت", "قميص", "بنطلون", "فستان", "عباية", "حذاء", "جزمة", "كوتشي", "شنطة", "ساعة", "clothes", "fashion", "shirt", "pants", "dress", "shoes", "bag", "watch"],
    strictQueryTerms: ["ملابس", "لبس", "تيشيرت", "حذاء", "شنطة", "ساعة", "fashion", "clothes", "shoes"],
    includeWords: ["ملابس", "لبس", "حذاء", "شنطة", "fashion", "clothes", "shoes"],
    excludeWords: [],
  },
  {
    id: "beauty",
    labelAr: "عناية وجمال",
    labelEn: "Beauty",
    terms: ["عطر", "برفان", "ميكب", "مكياج", "كريم", "عناية", "بشرة", "شعر", "شامبو", "perfume", "makeup", "cream", "skincare", "haircare", "shampoo"],
    strictQueryTerms: ["عطر", "برفان", "ميكب", "مكياج", "كريم", "عناية", "شامبو", "perfume", "makeup"],
    includeWords: ["عطر", "برفان", "مكياج", "كريم", "شامبو", "perfume", "makeup", "cream"],
    excludeWords: [],
  },
  {
    id: "stationery",
    labelAr: "مكتبة وأدوات مكتبية",
    labelEn: "Stationery",
    terms: ["مكتبة", "مكتبه", "كراسة", "كراسه", "كشكول", "قلم", "اقلام", "كتاب", "كتب", "ادوات مكتبية", "stationery", "notebook", "pen", "book", "office supplies"],
    strictQueryTerms: ["مكتبة", "مكتبه", "كراسة", "قلم", "كتاب", "stationery", "notebook", "pen"],
    includeWords: ["كراسة", "قلم", "كتاب", "مكتب", "stationery", "notebook", "pen", "book"],
    excludeWords: [],
  },
  {
    id: "sports",
    labelAr: "رياضة",
    labelEn: "Sports",
    terms: ["رياضة", "رياضه", "كرة", "كوره", "دمبل", "مات", "دراجة", "sports", "ball", "dumbbell", "bike", "fitness"],
    strictQueryTerms: ["رياضة", "كرة", "كوره", "دمبل", "sports", "ball"],
    includeWords: ["رياضة", "كرة", "دمبل", "sports", "ball", "fitness"],
    excludeWords: [],
  },
  {
    id: "kids_baby",
    labelAr: "أطفال ورضع",
    labelEn: "Kids & Baby",
    terms: ["اطفال", "أطفال", "طفل", "بيبي", "رضع", "لعبة", "لعبه", "العاب", "kids", "children", "baby", "toys", "toy"],
    strictQueryTerms: ["اطفال", "أطفال", "بيبي", "لعبة", "العاب", "kids", "baby", "toys"],
    includeWords: ["طفل", "بيبي", "لعبة", "kids", "baby", "toy"],
    excludeWords: [],
  },
  {
    id: "services",
    labelAr: "منتجات خدمية",
    labelEn: "Services",
    terms: ["خدمة", "خدمه", "خدمات", "منتج خدمي", "منتجات خدمية", "تصميم", "برمجة", "استشارة", "صيانة", "تسويق", "دورة", "كورس", "ترجمة", "كتابة", "service", "services", "design", "programming", "consultation", "maintenance", "marketing", "course", "translation", "writing"],
    strictQueryTerms: ["خدمة", "خدمه", "خدمات", "منتج خدمي", "تصميم", "برمجة", "استشارة", "صيانة", "service", "services"],
    includeWords: ["خدمة", "تصميم", "برمجة", "استشارة", "صيانة", "service", "design", "programming", "consultation"],
    excludeWords: [],
    service: true,
  },
];

export default {
  ECOMMERCE_GENERIC_TYPE_WORDS,
  ECOMMERCE_PRODUCT_TYPE_WORDS,
  ECOMMERCE_PRODUCT_BRAND_WORDS,
  ECOMMERCE_PRODUCT_BRAND_GROUPS,
  ECOMMERCE_PRODUCT_SYNONYMS,
  ECOMMERCE_PRODUCT_FAMILIES,
};
