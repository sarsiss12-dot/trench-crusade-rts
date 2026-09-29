# Evren notları — kanon ile oyun soyutlaması ayrımı

Bu proje **resmî olmayan** bir hayran oyunudur. Kural: resmî kaynakta doğrulanmayan hiçbir şey kanon olarak
sunulmaz. Her veri tanımında `lore.status` alanı bulunur ve test ile zorunludur:

| Durum | Anlamı |
|---|---|
| `canon` | Adı / temel niteliği resmî kaynakta doğrulandı (sayılar, RTS davranışı yine de oyun soyutlamasıdır) |
| `canon-inspired` | Resmî bir motiften türetilmiş, ama biçimi bu projeye ait |
| `abstraction` | Oynanış için tasarlanmış mekanik / yapı; kanon iddiası yok |

Oyun içinde **Ana menü → Evren Notları** ekranı bu tabloyu doğrudan verilerden üretir.

## Taraflar

| Varlık | Durum | Doğrulanan bilgi | Bu projenin yorumu / soyutlaması |
|---|---|---|---|
| Yeni Antakya Prensliği | canon | Cehennem Kapısı'nın gölgesindeki kale-şehir; "sekiz büyük kuşatmaya" dayanmış, "Avrupa ve Afrika'nın Kılıcı ve Kalkanı"; "topçu taburları Yeni Antakya'nın gururu" | Lojistik ekonomisi (malzeme / ikmal / insan gücü / erzak), cephane ve takviye mekanikleri |
| Kara Kâse Tarikatı | canon | Beelzebub, veba, cehennem sinekleri; enfekte ölüler "ayağa kalkar"; Sinek Tarikatı (Order of the Fly); kurbanların kalıntılarından sinek biçiminde sunaklar | Biyokütle / ceset ekonomisi, enfeksiyon ızgarası, yeniden kaldırma kuralları, sayılar |
| Demir Sultanlık | canon | Resmî lore ve savaş grubu listesinde Great Iron Wall, Azeb, Janissary, Sappers ve Jabirean Alchemist | Kompakt ekonomi, tahkimat düğümleri, role göre başlangıç paketleri ve kontrollü karşı taarruz doktrini RTS soyutlamasıdır |

## Birimler

| Birim | Durum | Doğrulanan | Proje yorumu |
|---|---|---|---|
| Yeoman | canon | Yeni Antakya temel piyadesi, sürgü mekanizmalı tüfek | 8 kişilik manga, cephane, siper davranışı |
| Muharebe İstihkâmcısı | canon | Mevzi tahkim edebilen uzman | İnşa / tamir / hurda toplama rolleri, otomatik pompalı tüfek seçimi, `combatUnit: false` |
| Mekanize Ağır Piyade | canon | Makine zırhlı, ağır silahlı birlik | Ağır makineli + dev çekiç donanımı, 3 kişilik manga |
| Kâse Kölesi (Grail Thrall) | canon | Ekipmansız "içi boşaltılmış kabuklar", toplu hâlde güçlenir | Sürü bonusu sayıları, ölülerden kaldırma kuralı |
| Ceset Muhafızı (Corpse Guard) | canon | Seçkin muhafız müritler | Enfekte tüfek donanımı ve sırt paraziti görseli bu projenin yorumu |
| Veba Şövalyesi (Plague Knight) | canon | Kara Kâse'nin zırhlı savaşçısı | Arma kabuğu görünümü ve veba kılıcı bu projenin yorumu |
| Köle Çalışma Takımı | canon-inspired | Grail Thrall resmî birimdir | Ceset taşıyan / organik yapı diken / yiyecek arayan işçi takımı biçimi bu projenin uyarlaması |
| Muharebe Sıhhiyecisi (Combat Medic) | canon | Yeni Antakya resmî listesinde | İyileştirme, erken enfeksiyon tedavisi, yaralı kaldırma bu projenin mekaniği |
| Siper Rahibi (Trench Cleric) | canon | Yeni Antakya resmî listesinde | Direnç / moral aurası, ölüleri kutsama ve yakma soyutlamadır |
| Teğmen (Lieutenant) | canon | Yeni Antakya savaş grubu lideri (masa oyununda savaş grubu başına 1) | Faz 4.1: pasif KOMUTA BÜTÜNLÜĞÜ aurası (~16 m) soyutlamadır; RTS'te sayı sınırı bilinçli olarak kaldırıldı |
| Keskin Nişancı Rahip (Sniper Priest) | canon | Yeni Antakya seçkini: "Devotees of the Church ritually blind themselves" (Trench Companion) | Faz 4.1: menzil / hasar / dolum sayıları ve hedef tercihi (subay, seçkin, mürettebat, destek) soyutlamadır |
| Hücum Alevcisi | canon-inspired | Alev makinesi Yeni Antakya cephaneliğinde (resmî kurallar; Shocktrooper'lar taşıyabilir) | İki kişilik alev takımı biçimi soyutlamadır |
| Beelzebub'un Habercisi (Herald of Beelzebub) | canon | Kara Kâse seçkini | Sinek bulutu aurası soyutlamadır |
| Amalgam | canon | Kara Kâse birlik türü | Ceset yığınında yükseltilmesi soyutlamadır |
| Tümörler Lordu (Lord of Tumours) | canon | Kara Kâse lideri | İyileştirme / öfke aurası soyutlamadır |
| Siviller | abstraction | Yeni Antakya kalabalık bir kale-şehirdir (kanon) | Yerleşim iş ekipleri, sığınma, tahliye tamamen oynanış soyutlaması |
| Hayvanlar (koyun, keçi, domuz, sığır, katır, köpek) | abstraction / canon-inspired | Sıradan hayvanlar; köpekler evrende geçer | Fantastik yaratık yok; sürü, kaçma, ağıl soyutlamadır |
| Azeb | canon | Resmî Demir Sultanlık birimi | 8 kişilik temel piyade / perde rolü, tüfek ve bütün sayılar soyutlama |
| Janissary | canon | Resmî Demir Sultanlık seçkini | 5 kişilik karşı-taarruz mangası, silah ve sayılar soyutlama |
| Sultanlık İstihkâmcısı (Sapper) | canon | Sappers resmî Sultanlık listesinde | İnşa, onarım, hurda toplama ve sanitasyon rolleri soyutlama |
| Cabirî Simyager (Jabirean Alchemist) | canon | Resmî Demir Sultanlık birimi | İki kişilik yakın destek ve veba temizleyen projektör soyutlama |

## Yapılar ve yetenekler

| Varlık | Durum | Not |
|---|---|---|
| Beelzebub Sunağı | canon | Resmî metin: sunaklar "kurbanlarının kalıntılarından canavar sinekler biçiminde" yapılır. Üretim binası işlevi oyun soyutlamasıdır |
| Kilise Burcu (hedef) | abstraction | Yeni Antakya surlu bir kale-şehirdir (kanon); bu tek bina kuşatma hedefi olarak soyutlamadır |
| Siper, kum torbası, dikenli tel | abstraction | Siper savaşı evrenin çekirdeği; RTS siper mekanikleri soyutlamadır |
| Makineli mevzi, gözetleme kulesi, cephane sandığı, ikmal deposu, tarla | abstraction | Birinci Dünya Savaşı tahkimatlarından esinli oynanış yapıları |
| Topçu Ateşi | abstraction | Topçu taburları kanon; çağrılabilir yaylım yeteneği soyutlama |
| Sinek Sürüsü | abstraction | Cehennem sinekleri kanon motif; kullanılabilir yetenek biçimi soyutlama |
| Havan Ateşi | abstraction | Resmî Yeni Antakya listesinde havan / topçu mürettebatı yok (kontrol edildi); genel 1. Dünya Savaşı silahı |
| Sargı Yeri | abstraction | Combat Medic resmî birimdir; bina soyutlamadır |
| İşaret Direği | abstraction | Observer resmî birimdir, topçu taburları resmî lore'dadır; bina soyutlamadır |
| Saha Atölyesi | canon-inspired | Endüstriyel kale-şehir motifi; saha atölyesi soyutlamadır |
| Cephane Deposu, Toplanma Noktası | abstraction | 1. Dünya Savaşı lojistiğinden esinli |
| Alçak kum torbası, göğüs siperi, kereste duvar, tahkimatlı duvar | abstraction | Tahkimatlı duvar, Yeni Antakya'nın surlu şehir oluşundan (kanon) esinlidir |
| Ceset Yığını, Veba Çukuru, Kemik Barikat | abstraction | Ceset kullanımı ve veba teması kanon; yapıların kendisi soyutlama |
| Sinek Yuvası | canon-inspired | Cehennem sinekleri, Beelzebub, Herald of Beelzebub, Fly Thrall resmî; yuva yapısı soyutlama |
| Kara Kâse kanı / parçalanma görselleri | abstraction | Görsel soyutlama; uydurma kanon biyoloji sunulmaz |
| Kaynak bölgeleri, Sivil Yerleşim, Tarla, Hayvan Ağılı, Taş Ocağı, konvoy | abstraction | Kale-şehrin çevresini besleyen kırsal ekonomi soyutlaması; bölge adları tür adıdır, kanon yer adı değildir |
| Beton Makineli Mevzi | abstraction | 1. Dünya Savaşı tahkimatından esinli |
| Veba ölçeği (Pestilence) ve kademeleri | abstraction | Veba / salgın Kara Kâse'nin kanon teması; ölçek ve kademe adları oynanış soyutlaması |
| Büyük Veba, Kara Dalga | abstraction | Kanon temadan esinli yetenek biçimleri |
| Arınma Ayini | abstraction | Ateşle arınma (alev makinesi resmî cephanelikte); ayin biçimi soyutlamadır |

## Uzmanlıklar (Faz 3)

Oyun içindeki kartlar da bu durumları gösterir. Adı resmî kurala / listeye dayanan seçenekler `canon-inspired`
olarak işaretlidir; kuralın kendisi (bonuslar, açtıkları) yine oyun soyutlamasıdır.

| Uzmanlık | Taraf / kademe | Durum | Dayanak |
|---|---|---|---|
| Tahkimat Doktrini | Yeni Antakya I | abstraction | Siper savaşı doktrini; Yeni Antakya surlu kale-şehirdir (kanon) |
| Lojistik Kolordusu | Yeni Antakya I | abstraction | — |
| İnanç ve Şifa | Yeni Antakya I | canon-inspired | Siper Rahibi ve Muharebe Sıhhiyecisi resmî listede |
| Ağır Topçu Doktrini | Yeni Antakya II | canon-inspired | "Topçu taburları Yeni Antakya'nın gururu" (resmî lore) |
| Mekanize Yedekler | Yeni Antakya II | canon-inspired | Mekanize Ağır Piyade resmî listede; yedek doktrini soyutlama |
| Tahkimatlı Yerleşimler | Yeni Antakya II | abstraction | — |
| İleri Lojistik | Yeni Antakya III | abstraction | — |
| Arınma Seferi | Yeni Antakya III | canon-inspired | Alev makineleri resmî cephanelikte; ayin soyutlama |
| Seçkin Savunma | Yeni Antakya III | canon-inspired | Teğmen resmî savaş grubu lideri |
| Ezici Sürü | Kara Kâse I | canon-inspired | "Overwhelming Horde" resmî Kara Kâse kuralı |
| Beelzebub'un Dokunuşu | Kara Kâse I | canon-inspired | "Beelzebub's Touch" resmî Kara Kâse kuralı |
| Büyük Açlık | Kara Kâse I | canon-inspired | "Great Hunger" resmî bir savaş grubu varyantının adı; ceset ekonomisi soyutlama |
| Beelzebub'un Habercileri | Kara Kâse II | canon-inspired | Herald of Beelzebub resmî seçkin |
| Kaynaşma | Kara Kâse II | canon-inspired | Amalgam resmî birlik türü |
| Veba Hâkimiyeti | Kara Kâse II | abstraction | — |
| Kara Dalga | Kara Kâse III | abstraction | — |
| Büyük Veba | Kara Kâse III | abstraction | — |
| Tümörler Lordu | Kara Kâse III | canon-inspired | Lord of Tumours resmî lider |

## Faz 4 eklemeleri

| Varlık | Durum | Doğrulanan | Proje yorumu |
|---|---|---|---|
| Sahra Topu Mevzii | canon-inspired | Resmî lore: "titanik topçu parçaları Yeni Antakya'nın dökümhanelerinde yapılır"; belirli bir sahra topu adı bulunamadı | Kanon adı yok; menzil, ikmal, en az menzil, mürettebat soyutlama |
| İç Organ Topu Yuvası | canon-inspired | Viscera Cannon — resmî Kara Kâse ağır silahı | Yere kök salmış organik yuva ve hastalık saçan atış soyutlama |
| Yozlaşma Püskürtücü Yuvası | canon-inspired | Corruption Belcher — resmî silah sözlüğünde geçer (taraf ataması doğrulanmadı) | Gaz bulutlu kısa menzil yuva soyutlama |
| ~~Komutan: HATTI TUT / VEBA KUTSAMASI~~ | kaldırıldı (Faz 4.1) | — | Aktif komutan yetenekleri, benzersiz sınır ve ölüm cezası kaldırıldı; birimler pasif SEÇKİN oldu |
| Seçkin pasif adları (Komuta Bütünlüğü, Kutsanmış Varlık, İşaretli Av, Veba Siperi, Tümör Sarayı, Sinek Bulutu) | abstraction | — | Birimler kanon; pasif adları ve sayıları bu projenin soyutlaması, kanon diye sunulmaz |
| Harabe garnizonları | abstraction | — | Savaşın yıktığı evler; kapasite ve siper kuralları soyutlama |
| Operasyonel duraklama | abstraction | — | Faz 4.1: ASLA ateşkes değil; yalnızca çatışma dışı birimlere inşa / onarım / takviye / ikmal / bastırma toparlanması bonusu |
| Yağmur ve trafik çamuru | abstraction | Yağmurlu, çamurlu siper cephesi evrenin görsel dilinde sürekli işlenir | Tohumlu sağanak takvimi, çamur ızgarası ve hız cezası soyutlama |
| Ceset Yığını başlangıç yapısı | abstraction | Kara Kâse'nin ölüleri kullanması kanon | Başlangıçta bir yığın + 22 m işleme alanı soyutlama |

## Faz 05A eklemeleri

| Varlık | Durum | Doğrulanan | Proje yorumu |
|---|---|---|---|
| Sahra Karargâhı (`field_hq`) | abstraction | Yeni Antakya'nın surlarından uzakta sefer yürüttüğü resmî lore'da var; siper savaşının ileri komuta noktaları tarihî | Taarruzda başlayan Yeni Antakya tarafının HQ'su; oyun soyutlaması, kanon yapı adı değil |
| Iron Sultanate / Heretic Legion (05A kilitli kartları) | canon (isimler) | Resmî Trench Crusade fraksiyonları | Tarihsel 05A durumu: içerik yoktu. Iron Sultanate 05B'de açıldı; Heretic Legion 05C için hâlâ kilitli |
| "Yeni Antakya Kuşatması" lore ön ayarı | abstraction | Yeni Antakya'nın kuşatmaları resmî lore'da var | Bir senaryo ön ayarıdır; tek olası savaş değildir. Ters rol ve ayna maçlar oyun kurgusudur, kanon olay iddiası değil |
| Fraksiyon kimlik satırları (kurulum kartları) | abstraction | — | Bu oyundaki fraksiyonların oynanış tarifi; lore iddiası değil |

## Faz 05B eklemeleri

| Varlık | Durum | Doğrulanan | Proje yorumu |
|---|---|---|---|
| Sultanlık Hisarı / İleri Karargâh | canon-inspired / abstraction | Demir Sultanlık ve Great Iron Wall kanon | Bu bina adları, ekonomi akışları ve HQ davranışı RTS soyutlaması |
| İstihkâmcı Ocağı / Sultanlık Tabiyası / Siper Duvarı | abstraction | Sappers ve Sultanlık tahkimat kimliği kanon | Bina biçimleri, maliyetler ve makineli mevzi davranışı oyun tasarımı |
| Demir Duvar Kesimi | canon-inspired | Great Iron Wall kanon | Haritadaki iki yerel segment ölçek soyutlaması; bütün duvarı temsil etmez |
| Köprü veba sürünmesi | abstraction | Kara Kâse'nin veba ve çürüme kimliği kanon | Hücre eşikleri, 30–90 sn hedefi, purge ile zincir kesme oynanış kuralı |
| Salt Tank / özel araçlar | uygulanmadı | Bu fazda doğrulanmış kaynak bulunmadı | Kanon diye eklenmedi; TODO olarak kaldı |

## Bilinçli olarak eklenmeyenler

Tanklar, alev makineli tanklar, Communicant'lar, Hounds / Fly Thrall gibi birimler resmî kaynaklarda var ancak henüz
uygulanmadı (bkz. `ROADMAP.md`). Amalgam, Herald of Beelzebub, Lord of Tumours, Combat Medic, Trench Cleric ve
Lieutenant Faz 3'te, Sniper Priest Faz 4.1'de, Demir Sultanlık temeli Faz 05B'de eklendi. Heretic Legion Faz 05C'de
kalır. `scenario.techEra` alanı ileride yıl/teknoloji ön ayarları için
ayrıldı; kaynakla doğrulanmadan içerik eklenmeyecek.

## Kaynaklar

- [Trench Crusade — The Principality of New Antioch (resmî lore)](https://www.trenchcrusade.com/lore/the-principality-of-new-antioch/)
- [Trench Crusade — The Cult of the Black Grail (resmî lore)](https://www.trenchcrusade.com/lore/the-cult-of-the-black-grail/)
- [Trench Crusade — Lore: Book V / Iron Sultanate (resmî)](https://www.trenchcrusade.com/lore/)
- [Trench Crusade — Warbands of Trench Crusade (resmî kurallar PDF)](https://www.trenchcrusade.com/app/uploads/2026/02/Warbands-of-Trench-Crusade.pdf)
- [Trench Crusade — Black Grail Faction Overview](https://www.trenchcrusade.com/trench-wire/gaming/black-grail-faction-overview/)
- [Trench Companion — New Antioch warband](https://trench-companion.com/compendium/warbands/new-antioch)
- [Trench Companion — Cult of the Black Grail warband](https://trench-companion.com/compendium/warbands/cult-of-the-black-grail)
- [Wikipedia — Trench Crusade](https://en.wikipedia.org/wiki/Trench_Crusade)
- [Trench Crusade — The Armaments of the Great War (resmî lore)](https://www.trenchcrusade.com/lore/the-armaments-of-the-great-war/)
- [New Recruit Wiki — Viscera Cannon](https://www.newrecruit.eu/wiki/trenchcrusade/trench-crusade/black-grail/9eea-4e25-e838-01e4/viscera-cannon)
- [Trench Companion — Battlekit glossary (Corruption Belcher)](https://trench-companion.com/compendium/battlekit/ranged)
- [Trench Companion — Warbands (Iron Sultanate, Heretic Legion…)](https://trench-companion.com/compendium/warbands)
