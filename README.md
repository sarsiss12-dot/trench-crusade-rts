# Yeni Antakya Kuşatması — mobil öncelikli 3D asimetrik kuşatma RTS

> **Resmî olmayan hayran projesi.** Trench Crusade evreninden esinlenmiştir. Uydurma içerik kanon olarak sunulmaz;
> her birim / yapı / yetenek verisinde `lore.status` alanı (`canon` / `canon-inspired` / `abstraction`) ve kaynak notu
> vardır. Ayrıntılar: [`docs/LORE.md`](docs/LORE.md).

HTML5 + JavaScript (native ES modules) + WebGL2 + Web Audio ile yazılmış, **harici model / doku / ses dosyası
kullanmayan** (her şey prosedürel), Android öncelikli, masaüstünde de oynanan bir kuşatma RTS'i.

- **Yeni Antakya (savunan):** siper kazar, kum torbası ve dikenli tel çeker, makineli mevzi kurar; haritadaki kaynak
  bölgelerine sivil yerleşimler kurarak yayılır (nüfus → insan gücü, tarla, ağıl, taş ocağı, konvoy); malzeme, ikmal,
  insan gücü ve erzak ile yaşar; cephane ikmal yarıçapı ve arkadan yürüyerek gelen takviye ile savaşır.
- **Kara Kâse (saldıran):** işçi → maden → kışla yoktur; hayvanları avlar, cesetleri biyokütleye çevirir, enfekte
  ölüleri düştükleri yerde yeniden kaldırır, Beelzebub sunaklarından ucuz Köle sürüleri yetiştirir, vebayı toprağa
  yayar, veba ölçeğini doldurup Büyük Veba'yı salar, sinek sürüsü salar.
- Akış: **HAZIRLIK** (hasar yok, konuşlanma bölgeleri, tahkimat) → **SAVAŞ** (süre veri ile ayarlı: 5–180 dk)
  → zafer / yenilgi (Kilise Burcu düşerse saldıran, süre dolarsa ya da saldıran tükenirse savunan kazanır).

---

## 1. Çalıştırma

Gereksinim yok (sıfır bağımlılık). Node.js ≥ 18 yalnızca geliştirme sunucusu, testler ve build için.

```bash
node tools/serve.js            # http://localhost:8080  (aynı ağdaki telefon için LAN adresi de yazdırılır)
npm test                       # = node tests/run.js      — 235 Node testi
npm run build                  # = node tools/build.js    — dist/index.html (tek dosya, çevrimdışı çalışır)
npm run balance                # = node tools/balance.js  — AI'ya karşı AI deterministik maçlar + Faz 3 denge ölçümleri
                               #   (--seeds 1,2,…  --minutes 15  --verbose  --json çıktı.json)
npm run test:browser           # = node tools/browser_smoke.js — (Playwright varsa) 9 gerçek tarayıcı kontrolü
node tools/showcase.js [ad]    # (Playwright varsa) Faz 2 + Faz 3 görsel sahneleri → test-output/showcase-*.png
                               #   Faz 3: p3_settlement, p3_units, p3_flame, p3_plague, p3_hud, p3_convoy
```

Build çıktısı `dist/index.html` tek başına çift tıklanarak (`file://`) veya herhangi bir statik sunucudan açılır.

**Doğrudan başlatma (URL parametreleri):**
`?autostart=1&faction=black_grail&minutes=30&seed=7&quality=high&prep=60` · `?stress=160|320|480` ·
`?view=gallery` (model galerisi) · `&ff=120` (120 sn ileri sar) · `&cam=x,z,mesafe` · `&debug=1` · `&lang=en` ·
`&fog=0` (sisi kapatır — yalnızca `debug=1` veya stres/sandbox modunda; normal maçta sis kapatılamaz)

**Tarayıcı gereksinimi:** WebGL2 (güncel Chrome/Edge/Firefox/Samsung Internet/Safari 15+). Android Chrome birincil
hedeftir. Yoksa açık bir hata mesajı gösterilir. Maç başlarken GPU bağlamı alınamazsa oyuncu çıkmaza düşmez: *düşük
kalitede yeniden dene / yeniden dene / ana menü* paneli çıkar. Uygulama değiştirme veya sürücü sıfırlaması yüzünden
WebGL bağlamı kaybolursa maç aynı simülasyon durumu, sis hafızası ve cesetlerle sayfa görünür olunca yeniden kurulur.

## 2. Kontroller

| Dokunmatik (birincil) | Fare / klavye |
|---|---|
| **Dokun:** seç · seçiliyken zemine dokun = ilerle · düşmana dokun = saldır | Sol tık: seç / emir, **sağ tık:** bağlamsal emir |
| **Sürükle:** kamerayı kaydır (ataletli) | Sol sürükle: kamera · Shift+sürükle: kutu seçimi |
| **İki parmak:** yakınlaştır + kaydır | Tekerlek veya `+`/`−`: yakınlaştır · Oklar: kaydır |
| **Çift dokun:** ekrandaki aynı türden tüm mangalar | `Q` Tümü · `E` istihkâm · `Ctrl+1–9`/`1–9` gruplar |
| **Basılı tut** (seçim varken): saldırarak ilerle | `A` saldırarak ilerle · `S` dur · `F` düzen · `R` döndür / takviye iste |
| **Yön verme:** hedefe çift dokun, ikinci dokunuşu bırakmadan sürükle → ok çıkar, bırakınca manga gider ve o yöne bakar | **Sağ sürükle:** hedef + bakış yönü |
| **Tümü** düğmesi: yaşayan + oyuncuya ait + `combatUnit === true` | `B` inşa · `Boşluk` üs · `P` duraklat · `[` `]` hız |
| **Kutu** kipi (sağ panel): tek parmak sürükleme = kutu seçimi | `Esc` iptal / seçimi bırak · `F1` hata ayıklama |
| **Çoklu** kipi: dokunuşlar seçime ekler/çıkarır · **✕** seçimi kaldır | |
| **Mini harita:** dokun / sürükle = kamerayı taşı | |
| **Yetenek:** ilk dokunuş alanı gösterir, alanın içine ikinci dokunuş onaylar | Yetenek: imleç alanı gösterir, tık onaylar |
| **İki parmaktan bir parmağa** geçince yalnızca kamera kayar (yanlışlıkla emir yok) | |

Sağ tık hiçbir işlev için **zorunlu değildir**; her şey dokunuşla yapılabilir.

**İnşa (Yeni Antakya):** İstihkâm seç → *İnşa* → yapı seç. Siper/tel/kum torbası için başlangıç ve bitiş noktasına
dokun (veya sürükle), ✓ ile onayla; bir sonraki parça önceki bitişten zincirlenir. Binalar için dokun / sürükle,
⟳ döndür, ✓ onayla. Geçersiz yerleştirme kırmızı hayalet + neden (bölge dışı, çakışma, kaynak…) gösterir.

## 2b. Faz 02 — Android geri bildirimi sonrası

Gerçek Android testinden (480 asker / HIGH ≈ en kötü 40 FPS) gelen geri bildirimle, çalışan sistemler yeniden
yazılmadan eklendi:

- **HOME düzeltmesi:** HOME / ilk kamera artık taraf farkında (`sim/home.js`): yaşayan HQ yapısı (burç / sunak;
  birden çok sunakta çapaya en yakını), yoksa tarafa özgü harita çapası. Eski hata: Kara Kâse HOME'u sunaklar yerine
  orman cephesindeki toplanma çapalarının ortalamasına gidiyordu.
- **Yön komutu:** MOVE komutuna isteğe bağlı, serileştirilebilir `face` (radyan). Manga varışta o yöne döner, bekleme
  emri yönü korur; çoklu seçimde düzen hattı yöne dik açılır. Siper yuvaları kendi yönünü kullanır.
- **Takviye yeniden tasarımı:** "Takviye İste" mangayı cepheden çekmez. Kaynak (burç / ikmal deposu / toplanma
  noktası) gerekir; her yedek için insan gücü + ikmal ödenir, yedek kaynakta doğar ve **yürüyerek** gelir, boş düzen /
  siper yuvasını alır. Yol kesikse gecikir (bildirim), kaynak yok olursa iptal; yolda vurulabilir; ışınlanma yok.
- **Yeni Antakya yapıları:** sargı yeri (iyileştirme, enfeksiyon tedavisi), saha atölyesi (malzeme, onarım aurası,
  tahkimatlı duvarı açar), cephane deposu (geniş ikmal; yıkılınca patlar), işaret direği (topçu/havan bekleme
  süresi ×0.8), toplanma noktası (takviye kaynağı, ikmal → insan gücü).
- **Duvar ailesi:** alçak kum torbası, toprak göğüs siperi (patlamaya dirençli), takviyeli kereste duvar, tahkimatlı
  duvar (geçilmez; aralar geçit) + mevcut siper / kum torbası / tel. Her biri ayrı yönlü siper türü ve hareket etkisi.
- **Kara Kâse inşası:** Köle Çalışma Takımı (ucuz, yavaş, zayıf, en fazla 4) ceset taşır ve organik yapı diker:
  ceset yığını, veba çukuru, sinek yuvası, kemik barikat, (oyuncu için) yeni sunak. Kendi bölgesinde veya ağır
  enfekte zeminde. Yeni Antakya ile aynı menü değil (asimetri korunur).
- **Sinek Sürüsü okunabilirliği:** koyu dönen sinek bulutu, gölge, soluk miasma, kalan süreyi gösteren halka, etkilenen
  askerlerde hastalık rengi + sinekler + sendeleme + çubukta enfeksiyon göstergesi, verilerden üretilen yetenek bilgisi
  (hasar/sn, enfeksiyon aralığı, isabet düşüşü, süre, yarıçap, bekleme). Sis arkasından sızıntı yok (`effectVisibleTo`).
- **Beelzebub Sunağı:** kanon sinek biçimi korunarak ölülerden örülmüş dev sinek: ceset yığını kaide, kaynaşmış
  bedenlerden karın, kemik plakalı göğüs, kafataslarından baş, faset gözler, kâse biçimli sunu kabı, yırtık deri
  kanatlar, kemik bacaklar, kazıklı kurbanlar, zincirler, sinekler.
- **Vahşet (yalnızca sunum):** neden / fazla hasar / patlama gücüne göre parçalanma (kol, bacak, kafa, patlayıcı,
  felaket); ayrılan uzuvlar sınırlı havuzda balistik uçar, yere oturur, kan izi bırakır; kan katmanları (isabet sisi,
  ağır püskürme, yönlü parçalanma patlaması, sınırlı zemin göllenmesi, ceset lekesi); Kara Kâse için koyu enfekte
  sıvı + hastalık zerreleri + sinekler. Oyun RNG'si kullanılmaz (asker kimliği hash'i).
- **Topçu / havan:** flaş, toprak sütunu, enkaz, şok halkası, sınırlı duman sütunu, mesafeye göre sarsıntı;
  **kalıcı, sınırlı (48) kraterler** (birleşir, hafif siper verir, arazi yalnızca görülen kraterlerde oyulur).
  Havan Ateşi: çok sayıda küçük mermi, kısa bekleme, bastırma (isabet ve hız düşer), krater bırakmaz.
- **Ses:** katmanlı silah sesleri (çatlama + telefon hoparlörü bandında gövde + mekanik + kuyruk), MG ritmi, ağır silah
  daha pes, pompalı daha geniş, topçu alt bas + darbe + gümbürtü; öncelikli ses bütçesi; uzak çatışma toplu cızırtı +
  gümbürtüye dönüşür; sınırlayıcı. **Prosedürel müzik** (drone, metal rezonans, davul, frig ezgi, çok ölçülü koro,
  gümbürtü; HAZIRLIK / SAVAŞ / KRİTİK + zafer/yenilgi), ayrı Müzik / Efekt ses ayarı, patlamalarda müzik kısılır.
- **Yapı hasar evreleri:** SAĞLAM / HASARLI (is, enkaz, duman) / KRİTİK (çatlaklar, kararma); yıkılınca çöküş;
  Kara Kâse yapıları yırtılır (koyu biyokütle, sıvı, sinek bulutu).
- **Kayıt:** sürüm 2 + 1→2 göçü (kraterler, takviye istekleri, bastırma, havan yeteneği; eski "takviyeye geri yürü"
  emirleri yerinde bekleyen isteğe dönüşür). Eski kayıtlar sessizce bozulmaz (test).

## 2c. Faz 03 — Yaşayan cephe, asimetrik ekonomi, veba

Çalışan Faz 1–2 sistemleri korunarak, aynı kaynak ağacında eklendi (kayıt sürümü 3):

- **Yeni Antakya yayılmak zorunda:** haritada 10 **kaynak bölgesi** (verimli toprak ×3, mera ×2, harap köy ×2,
  taş ocağı, hurda sahası, terk edilmiş depo); zenginlik (fakir / orta / zengin) her maçta tohumdan çekilir, en iyi
  yayılma sırası maçtan maça değişir. Bölgeye **Sivil Yerleşim** kurulur (60 malzeme + 40 ikmal); çevresine tarla,
  hayvan ağılı, taş ocağı açılır (bölge türü belirler). HAZIRLIK'ta en fazla 2 yerleşim.
- **Kaynaklar:** erzak / malzeme / ikmal / insan gücü. **Nüfus harcanmaz**; insan gücü üretim kapasitesini belirler:
  insan gücü = hafif pasif akış (1,5/dk) + güvende olan sivil × 0,1/dk × erzak katsayısı; her acemi 4 erzak yer.
  Uzak yerleşimlerin üretimi **fiziksel konvoylarla** (katır + araba) eve gider; konvoy yolda vurulabilir.
- **Siviller:** yerleşim başına görünür iş ekibi (en fazla 6) tarlada çalışır, yük taşır, görünen tehlikede sığınır.
  **TAHLİYE** komutu insanları güvene yürütür (nüfus korunur); 45 sn güvenlikten sonra yerleşim yeniden dolar.
  Yerleşim düşerse içindeki nüfus kaybedilir. Siviller komut almaz, seçilmez (performans için grup hâlinde).
- **İstihkâmcı arama derdi yok:** seçim yokken verilen İNŞA emri, şantiyeye en yakın **müsait** istihkâmcıya gider
  (meşgulse sıraya — en fazla 4 iş); HUD kenarındaki **istihkâm şeridi** her ekibin durumunu gösterir (Hazır / Yolda /
  İnşa / Onarım / Temizlik / Tehlike), dokununca seçer ve kamerayı götürür. Atanan ekip 3 sn parlar; haritada nabız
  halkası + şantiyeye ışın + işaret. İş bitince en yakın yerleşim / atölye / burca döner, HAZIR olur.
- **Hayvanlar:** koyun, keçi, domuz, sığır, katır, sokak köpeği (fantastik yaratık yok); 10 yaşam alanı, alan başına
  sınır + toplam 64 sınırı, **yavaş** geri dolma (75–120 sn; ölümden sonra en erken 60 sn). Sürü dolaşımı, kaçma,
  askerlerden çekinme; Kâse'nin kokusunu uzaktan alırlar. **Hayvan ağılı:** çobanlar (siviller) yakındaki hayvanları
  canlı sürüp getirir (SÜRÜ ALANI), ağıldakiler sürekli erzak verir; **acil kesim** bütün sürüyü hemen erzağa çevirir
  (Kâse'ye leş kalmaz).
- **Kara Kâse beslenmesi:** köle takımlarına **YİYECEK ARA** bölge emri (tek tek hayvan seçmek yok): uygun hayvanı
  avlar, leşi soyar, en yakın sunağa / ceset yığınına taşır, alan boşalınca bekler; boşta kalan takım yakındaki
  bilinen cesetlere kendiliğinden gider. Biyokütle kaynakları: hayvan (düşük), eski savaş ölüleri (düşük-orta),
  sivil (orta), düşman askeri (yüksek), ağır zırhlı (daha yüksek), kendi ölüleri (düşük), sunak pasif geliri
  (çok düşük: sunak başına 0,14/sn — yalnızca ilk dalgalar için taban).
- **Ucuz Köle sürüsü:** Kâse Kölesi mangası 12 kişi, 60 biyokütle (kişi başı 5); "Ezici Sürü" bonusu yakındaki Kâse
  bedenleriyle büyür ama **üst sınırlıdır** (üstel değil). Makineli + tel + alev hâlâ karşılığıdır (test).
- **Veba (Pestilence) 0–100:** 5 kademe (Uykuda / Çürüyor / Salgın / Veba Dalgası / BÜYÜK VEBA HAZIR), veri odaklı.
  Enfeksiyon, enfekte ölüler, dirilişler, hayvan ölümleri, enfekte toprak ve veba yapılarıyla artar; yakma, temizlik,
  tedavi, veba yapılarının yıkımı ve uzun süre başarısızlıkla düşer. Artış yükseldikçe zorlaşır ve savaş süresine
  göre ölçeklenir. 100'de **Büyük Veba** yeteneği vebanın 60'ını harcar (kalıcı kartopu yok). Bulut tek başına en
  fazla 3 enfeksiyon bulaştırır: bulutta kalan savunmasız manga ağır kayıp verir, sıhhiyeciyle çekilen manga kurtulur.
- **Diriliş:** yeterince enfekte ölen asker **enfekte ceset** olur, sayaç dolunca düştüğü yerde Köle olarak kalkar
  (anında değil). Uyarı: cesedin üstünde sinekler / hastalık zerreleri. Karşılık: yakma (alev, temizlik, rahip,
  Arınma Ayini), kutsanmış zemin.
- **Karşı-veba:** Muharebe Sıhhiyecisi (erken enfeksiyonu tedavi, geç enfeksiyonu yavaşlatır, yaralıyı kaldırır —
  bağışıklık yok), Siper Rahibi (direnç aurası, moral, yakındaki ölüler kalkamaz, enfekte cesetleri yakar), Hücum
  Alevcisi (atölye gerekir, en fazla 2 takım: sürüyü, cesetleri, enfekte zemini, organik / ahşap yapıları yakar; boşta
  menzildeki bilinen enfekte cesetleri kendiliğinden yakar), **ALANI TEMİZLE** (istihkâmcılar alandaki her cesedi
  yakar, sonra zemini kazır; ikmal ister), sınırlı **yaralı asker** (kan kaybından ölür ya da kaldırılır).
- **Uzmanlıklar:** taraf başına 3 kademe × 3 seçenek (maçın başında / %30 / %60'ında açılır), geri alınamaz, 3 büyük
  kart + onay; her biri oynanışı değiştirir (yeni birim / yapı / yetenek / kural), küçük stat bonusu değil. Yeni
  Antakya: Tahkimat Doktrini, Lojistik Kolordusu, İnanç ve Şifa → Ağır Topçu, Mekanize Yedekler, Tahkimatlı
  Yerleşimler → İleri Lojistik, Arınma Seferi, Seçkin Savunma. Kara Kâse: Ezici Sürü, Beelzebub'un Dokunuşu, Büyük
  Açlık → Beelzebub'un Habercileri, Kaynaşma, Veba Hâkimiyeti → Kara Dalga, Büyük Veba, Tümörler Lordu.
  Kanon adlar ayrıca işaretlidir (ör. "Overwhelming Horde", "Beelzebub's Touch" resmî kurallardır); gerisi soyutlama.
- **Kahraman / seçkin (spam yok):** Teğmen, Siper Rahibi (Yeni Antakya); Beelzebub'un Habercisi (en fazla 2),
  Amalgam (en fazla 3, ceset yığınında), Tümörler Lordu (en fazla 1) — uzmanlık kilidi + manga sınırı.
- **Çok mangalı siper:** siper ağı birden çok mangayı **bütün hâlinde** alır (yarım manga yok); dolu ağ yönlendirir veya
  reddeder. Siper seçilince **"N manga · kullanılan/toplam yer"** rozeti; rozete dokununca mangaların kartları
  (simge, ad, sağ/toplam, can, cephane, enfeksiyon) açılır, karta dokunmak o mangayı seçer.
- **Yapay zekâ:** Yeni Antakya HAZIRLIK'ta 1–2 yerleşim kurar (güvenli + zengin önce; ordunun koruyabileceğinden
  fazla değil), tarla / ağıl / ocak ekler, açıktakileri hafif tahkim eder, ezilmek üzere olanı tahliye eder,
  tehdit altındaki ağılı keser, görünen hayvanlara çoban yollar, enfekte ölüleri yaktırır, uzmanlık seçer. Kara Kâse
  görünen hayvanları → bilinen cesetleri → bildiği otlak / ormanı arar, yağma baskınları yapar, Büyük Veba / Kara
  Dalga kullanır, uzmanlık seçer. Hepsi normal komut hattından; gizli bilgi kullanmaz.
- **Sunum:** yeni modeller (sıhhiyeci, rahip, alevci, teğmen, 4 sivil çeşidi, haberci, amalgam, lord; aynı iskelete
  dört ayaklı olarak oturan 6 hayvan; katır arabası; yerleşim, tarla, ağıl, taş ocağı, beton mevzi), hayvan
  animasyonu (tırıs, dörtnala, otlama, ölüm), alev hüzmesi, yakma ateşi, yanan askerler, veba bulutu, arınma alevleri,
  kara dalga zerreleri, dönüşmekte olan ceset sinekleri; bölge halkaları + zenginlik noktaları, yerleşim alanı, sürü
  alanı, yiyecek / temizlik daireleri; mini haritada bölgeler, konvoylar, siviller; sesler (alev, hayvanlar,
  çatırtı, veba, tahliye çanı, kademe borazanı). Harici varlık yok.
- **Kayıt:** sürüm 3 + 2→3 göçü (eski kayıt, tohumundan deterministik olarak yaşayan dünyayı kazanır).

## 2d. Faz 04 — Muharebe akışı, komutan, garnizon, sahra topu, ses kurtarma, mobil gruplar

- **Ses kurtarma:** `src/audio/recovery.js` durum makinesi (askıya alınmış / kesintiye uğramış / kapalı bağlam,
  görünürlük, odak, dokunuş), 1 Hz bekçi, tek grafik / tek müzik (çift başlatma yok), durmuş zamanlayıcıyı atlatma.
  Müzik orta frekans katmanlarıyla (yaylı ped, çekme, boru, davul gövdesi) telefonda duyulur olacak şekilde yeniden
  yazıldı; ayrı müzik ses düzeyi; uzak cephe ambiyansı (konumsuz). *Kurtarma mantığı Node'da sahte Web Audio ile test
  edildi; gerçek Android'de dinlenmedi.*
- **Takviye:** yürüyen yedek, varana kadar HP / canlı sayısı / siper yuvası / güç hesabına girmez; "+N YOLDA";
  vardığında deterministik KATILMA olayı. Otomatik takviye: manga başına anahtar + taraf varsayılanı (Kapalı / Önemli / Tümü).
- **Kontrol grupları 1/2/3:** uzun bas = kaydet, dokun = seç, çift dokun = seç + kamera; masaüstü Ctrl+1..9 / 1..9;
  ölüler düşer; kayıt meta verisinde saklanır. Çoklu Seçim düğmesi etiketli ve AÇIK durumu belirgin.
- **Kaynak / hurda:** parmak için geniş hurda seçim yarıçapı (dünya + ekran izdüşümü), toplama modunda parlayan yığınlar,
  HURDA ALANI emri (alan boşalınca merkeze dönüş), EKONOMİ GÖRÜNÜMÜ, tarla / taş ocağı çalışma tozu, sivil ALARM
  (bildirim, zil, işaret, sığınan yerleşim halkası).
- **Operasyonel duraklama:** SAVAŞ I → YENİDEN ÖRGÜTLENME → SAVAŞ II…; tohumlu zamanlama (%25–40, %55–75), 8–12 sn
  uyarı, 45–60 sn; saldırı emirleri reddedilir, kendi bölgesinde öz savunma; maç ayarı Otomatik / Kapalı / 1 / 2.
- **Harabe garnizonu:** 11 harabe (10 ev + şapel) gerçek garnizon yapısı: giriş kapıları (şapelde iki), iç ve atış
  yuvaları, kapasite (küçük ev 1, büyük ev / şapel 2 manga); en yakın kapıdan giriş (kapı hücreleri artık açık);
  yüksek siper, ama patlama / alev / ağır makineli tehlikeli; ÇÖKME kayıp + bastırma; siper paneli yeniden kullanıldı;
  düşman garnizonu sisle boş harabeden ayırt edilemez.
- **Sahra Topu Mevzii** (kanon adı yok): uzun menzil, yavaş atış, atış başına ikmal, 28 m en az menzil, yavaş dönüş,
  yakın düşman mürettebatı susturur; mermi uçuş süresi, krater, enkaz, duman, büyük bastırma; geri tepen namlu modeli.
- **Komutan:** Yeni Antakya Teğmeni (HATTI TUT) ve Tümörler Efendisi (VEBA KUTSAMASI) maça sahada başlar; sınır 1;
  ölünce aura gider, çevrede moral şoku, 60 sn yetenek dolum cezası, 150 sn sonra iki kat bedelle bir kez yenilenebilir.
- **Kara Kâse:** Köle 50 biyokütle / 11 sn (daha zayıf tek tek), başlangıç biyokütlesi 110, sunak geliri 0.17/sn,
  savaşın ilk 3 dakikasında daha küçük ve sık dalgalar; Sinek Sürüsü uyarısı; İç Organ Topu Yuvası (Viscera Cannon
  adına dayanır) ve Yozlaşma Püskürtücü Yuvası (Corruption Belcher adına dayanır) — ikisi de soyutlama, kanon iddiası yok.
- **Kayıt sürümü 4** + v3→v4 göçü (harabeler yüklemede haritadan kurulur, eski liderler komutan olur, göç edilen maçta
  duraklama yok).

## 3. Mimari

Tek kaynak ağacı, alan (domain) bazlı modüller, **döngüsel bağımlılık yok** (test ile zorunlu), dev `game.js` yok.

```
src/
  core/         rng (sfc32, durum GameState içinde), dmath (deterministik sin/cos/atan2), events, noise
  data/         units, weapons, structures, factions, abilities, cover, terrain_types, maps, scenarios  (veri odaklı)
  world/        mapgen (katmanlı harita), terrain, nav (A* + yumuşatma + önbellek), fog, ground, structgrid
  sim/          state (JSON GameState), commands, simulation (sabit 20 Hz tick), match, perception (sis + görünürlük
                bitmaskeleri + olay filtreleme), production, abilities (+ kraterler, patlamalar), scenario, home (taraf
                farkında HOME), corpses, runtime (yeniden kurulabilir önbellekler); Faz 3: wildlife (hayvanlar,
                ağıllar), specialities (uzmanlık kuralları), auras (rahip / lider auraları)
  units/        orders (manga emir makinesi, yol istek kısıtlama), movement (manga + asker yönlendirme), formation,
                engineers (otomatik istihkâmcı atama, sıra, merkeze dönüş, durum)
  combat/       combat (menzil/yakın dövüş, tepki gecikmesi, ölüm → ceset), cover (arazi + siper + yönlü kum torbası)
  construction/ trench (SİPER TEK DOĞRULUK KAYNAĞI), construction (yerleştirme doğrulama → şantiye → iş → tamam)
  economy/ factions/  ortak ekonomi yardımcıları + Yeni Antakya lojistiği (reinforcement: yürüyen yedekler) /
                Kara Kâse ceset ekonomisi; Faz 3: economy/sectors, settlements (nüfus → insan gücü), convoys;
                factions/civilians (iş ekipleri, sığınma, tahliye), pestilence (veba ölçeği, enfeksiyon girişi)
  ai/           ai (zamanlayıcı), black_grail_ai (hat bazlı dalgalar, yeniden emir), new_antioch_ai (savunma planı),
                new_antioch_econ (yayılma), black_grail_econ (yiyecek arama, baskın), spec_pick (uzmanlık seçimi)
  save/         codec (sürümlü, göç zinciri, typed array base64), storage (slotlar, sandbox yalıtımı)
  render/       renderer (geçiş sırası), shaders, terrain_mesh, units_renderer (instanced skinning, poz dokusu),
                anim (prosedürel FK+IK, kopuk uzuv / uçan uzuv satırları), gore (DOM'suz vahşet planı + havuzlar),
                craters (görülen krater hafızası + profil), static_renderer, clutter, fortifications_renderer, fx,
                overlays, fog_memory, camera, gl, math3d, textures,
                models/ (humans, humans_p3, animals, props, structures, structures_p2, structures_p3, walls…)
  input/        gestures (DOM'suz jest tanıyıcı), selection, pick (sise saygılı), controller (DOM bağlama)
  ui/           hud (+ hud_p3: veba / nüfus / uzmanlık / istihkâm şeridi / siper paneli), engineer_highlight,
                trench_panel (DOM'suz, test edilir), minimap, menu, debug, i18n (TR/EN), icons, dom, style.css
  audio/        audio (Web Audio sentezi: katmanlı silahlar, ses bütçesi, uzak cephe), music (prosedürel müzik)
  app/          session (sabit adım, hız, olay dağıtımı, komut günlüğü), actions (niyet → komut), game (bağlama)
  main.js       giriş: ayarlar, menüler, maç yaşam döngüsü
```

**Akış:** `INPUT → COMMAND (düz veri, tick + seq) → SIMULATION → EVENT → (sis filtresi) → RENDER / UI / AUDIO`.

- **Simülasyon ↔ sunum ayrımı:** `sim/core/data/world/units/combat/construction/economy/factions/ai/save` hiçbir
  zaman `render/ui/input/audio/app`'e bağımlı değildir; simülasyonda `Math.random`, `Math.sin/cos/atan2/pow/exp`,
  `Date.now`, DOM erişimi yasaktır (test ile taranır). Tüm açılar deterministik polinomlarla hesaplanır.
- **Determinizm:** aynı başlangıç durumu + tohum + komutlar + tick sayısı ⇒ aynı durum özeti (test edilir).
  Komutlar tick/seq taşır; AI da aynı komut hattını kullanır ⇒ lockstep çok oyunculu mimariye hazır (ağ yok).
- **GameState** düz JSON'dur (typed array'ler codec ile base64); runtime önbellekleri (nav, grid'ler, indeksler)
  durumdan yeniden kurulur, kayda girmez. Kayıt sürümü 3, göç zinciri (0→1→2→3) mevcut.
- **Manga düzeyi yapay zekâ:** yol bulma manga başına (4 istek/tick kısıtlamalı, LRU önbellek); askerler düzen
  yuvalarına / siper yuvalarına / iş noktalarına yönlenir; ayırma döngüsü açık döngülerle.
- **Siper tek doğruluk kaynağı:** `construction/trench.js` — gezinme maliyeti, siper (cover) gücü, doluluk yuvaları,
  zemin yüksekliği, arazi oyma, çizim ağı ve mini harita hep aynı segment verisinden türetilir.

## 4. Sistemler

- **Harita (320×576 m):** Yeni Antakya bölgesi → harabeler → ara bölge (no man's land, kraterler, eski siperler,
  eski teller) → nehir + köprü + iki sığ geçit → orman / krater / çamur → Kara Kâse yaklaşımı (enfekte toprak, sunaklar).
- **Savaş sisi (3 durum):** keşfedilmemiş / keşfedilmiş / görünür. Görünürlük bitmaskeleri hem AI'yı hem tüm sunumu
  besler; gizli birimler, can çubukları, HUD, mini harita, namlu alevi, iz mermisi, isabet, patlama, tıklama/isabet
  testi, keşfedilmemiş kaynaklar **sızdırılmaz**. Görünürlük **asker bazlıdır**: mangasının yarısı görünen bir
  düşmanın yalnızca görünen askerleri çizilir, seçilir, hedeflenir (orman / harabe / siper gizlenmesi dahil); can
  çubuğu ve mini harita noktası görünen askerlerin merkezindedir. Gizli atıcının sadece kendi askerine isabeti
  hissedilir (kaynak konumu, yönü ve mermi izi açığa çıkmaz). Görünmeyen hedefe verilen saldırı emri **son bilinen
  konuma** gider ve orada arar; kör atış yoktur.
- **Sis hafızası (oyuncunun bilgisi, simülasyon değil):** düşman yapıları son görüldükleri hâliyle (sisin arkasında
  yıkılsa da) kalır; kaynak yığınları son görülen miktarla, enfekte toprak son görülen hâliyle, cesetler görüldükleri
  yerde durur. Zemin oyma, siper çizimi, zemin dağınıklığı, mini harita, HUD, seçim ve toplama noktası hep bu hafızayı
  okur. Hafıza kayıtla saklanır ve GPU bağlamı kaybında korunur.
- **Hareket dayanıklılığı:** ilerleyemeyen askeri bir bekçi fark eder ve bütçeli bir kurtarma yolu verir; hedef
  geçilemez hücredeyse en yakın geçilebilir noktaya kaydırılır; çıkışsız cepte kalan asker mangasının yanına
  katılır; takviye birliklere katılma zaman aşımı vardır. Siper garnizonları kayıpları yeniden dağıtır.
- **Siper sistemi:** kademeli kazma (işaretleme → derinleşme), uç uca bağlanma (snap), otomatik doluluk (siper
  üzerine verilen ilerleme emri mangayı yuvalara dağıtır), siper gücü kazı ilerlemesine bağlı, HUD'da aktif siper.
- **Siper (cover):** orman / krater (hafif), harabe / kum torbası (orta, yönlü), siper / tahkimat (ağır); hasar
  azaltma + isabet cezası veri odaklı.
- **Ekonomi:** Yeni Antakya — kaynak bölgelerine yerleşimler, sivil nüfus → insan gücü, erzak, konvoylar, hurda
  toplama (fiziksel taşıma), depo/burçtan ikmal, cephane + ikmal yarıçapı, arkadan yürüyen takviye. Kara Kâse —
  hayvan / ceset / sivil / asker biyokütlesi (yiyecek arama bölgeleri), çok düşük sunak geliri, enfekte ölüleri yeniden
  kaldırma, sunaklardan üretim, enfeksiyon ızgarası, veba ölçeği, sinek sürüsü, Büyük Veba.
- **Yapay zekâ:** Kara Kâse savaş başlar başlamaz saldırır (hat/aşama bazlı, yeniden deneme ve yeniden emir,
  destek birimleri hariç), Yeni Antakya savunma planını gerçek inşa hattıyla uygular, garnizon/rezerv/topçu kullanır.
- **Görsel:** WebGL2; instanced skinned askerler (CPU'da prosedürel poz → RGBA32F poz dokusu, 14 kemik), LOD0/LOD1,
  bütçeli ceset havuzu, gerçek güneş gölge haritası (PCF), yarım küre + güneş + kenar ışığı, malzeme tepkisi
  (kumaş/deri/metal/ten/ıslak et/ahşap/cam/kemik/toprak/çamur/taş), gürültü dokusundan kir/çamur/pas, arduvaz çatı
  deseni, sis dokusu, enfeksiyon dokusu, çamur/su birikintileri, zemin dağınıklığı (kuru ot, taş, tahta, kovan),
  havuzlu parçacık + decal (namlu alevi, iz mermisi, isabet türleri, ağır/hafif patlama, duman, sinek, kan, yanık),
  kamera sarsıntısı, ACES tonemap + renk dengesi + vinyet, dinamik çözünürlük.
- **Ses:** tamamen sentez — tüfek / makineli / pompalı / enfekte tüfek / patlama / yakın dövüş / çığlık / inşa /
  çan / borazan / topçu ıslığı / rüzgâr / uzak cephe / sinek vızıltısı / kazma; mesafe + ekran konumu, ses sınırı.
- **UI:** Türkçe (tam İngilizce), merkezi i18n; kompakt koyu gotik HUD, bağlama duyarlı can/cephane/siper
  göstergeleri (seçili, hasar görmüş veya çatışmadaki mangalar), inşa menüsü + hayalet önizleme + onay/döndür/iptal,
  üretim kuyruğu, toplanma noktası, bildirimler, mini harita, duraklatma, bitiş ekranı, kayıt/yükle, ayarlar.
- **Stres modu:** 160 / 320 / 480 asker, AI'ya karşı AI, FPS / çizim çağrısı / parçacık / ceset / manga / asker
  göstergeleri; kampanya kayıtlarına dokunmaz (ayrı sandbox deposu).

## 5. Testler

`npm test` — 235 test (Node, sıfır bağımlılık; Faz 4: `tests/phase4.test.js` 31 + `tests/audio.test.js` 9): mimari (döngü yok, katman kuralları, yasak API'ler, import konumu,
DOM'suz modüller), simülasyon, savaş, hareket (sıkışma kurtarma, cepler, katılma), inşa/siper, ekonomi, AI,
kayıt/yükleme + göç, determinizm (kayıt → yükle → devam = kesintisiz), sis (asker bazlı görünürlük, kör atış yok,
olay temizleme, düşen askerin mangasını açığa çıkarmaması), yol bulma (A* iş bütçesi, önbellekten bağımsızlık), mobil
girdi (jest eşikleri, uzun basma, pinch sonrası kaydırma, zincirli yerleştirme, Tümü kuralı, sise saygılı seçim),
sunum (sabit adım, ileri sarmada maç sonu, olay filtresi, sis hafızası yeniden kurma/yükleme, bilinen siperle zemin
oyma, i18n eksiksizliği), render (ertelenmiş canvas boyutu, piksel bütçesi, çubuk kalınlığı, artımlı arazi = tam
yeniden kurma), stres (160 / 320 / 480 asker bütçesi + sunum CPU ölçümü). Faz 2 (`tests/phase2.test.js`,
`render.test.js`, `input.test.js`): taraf farkında HOME, Sinek Sürüsü hasar/enfeksiyon + sis filtresi, yön komutu
serileştirme + kayıt/yükleme, yürüyen takviye, siperde takviye, yol kesik / kaynak kaybı, yeni yapılar, duvar
siperleri, Kara Kâse inşası, köle ekonomisi, krater sınırı, kan gölü / uzuv havuzu sınırı, eski kayıt göçü, AI'nın
yeni komutları kullanması, yön jesti. Faz 3 (`tests/phase3.test.js`, 36 test + `stress.test.js`'e 2 yaşayan dünya
ölçümü): çoklu yerleşim bölgeleri, yerleşim ekonomisi, erzak → insan gücü, pasif insan gücü, tahliye, sığınma,
hayvan sınırı, geri dolma hızı, sürü toplama + kesim, Kâse hayvan hasadı, otomatik yiyecek arama, ucuz Köle sürüsü,
makineli + tel + alev karşılığı, veba artış/azalış + kademeler + Büyük Veba harcaması, Büyük Veba karşılığı (bulutta
kalan / sıhhiyeciyle çekilen), enfekte ceset → Köle, yakmanın dirilişi önlemesi, sıhhiyeci / rahip / alevci /
ALANI TEMİZLE, uzmanlık kademeleri + kayıt/yükleme, istihkâmcı otomatik atama / en yakın müsait / vurgulama / merkeze
dönüş, çok mangalı siper kapasitesi + kart verisi, sis filtresi (yerleşim, hayvan, konvoy, uzmanlık, diriliş), AI
yayılması, AI yiyecek araması, determinizm (yaşayan dünya + iki AI + kayıt/yükleme), v2→v3 göçü. Düzeltilen her hata
için bir regresyon testi eklendi.

`npm run test:browser` — başsız Chromium (GPU yoksa SwiftShader) ile 9 kontrol: menü, Yeni Antakya, dikey telefonda
Kara Kâse, dokunmatik seç + ilerle, **GPU bağlamı kaybından dönüş**, **başlatma hatasından kurtarma paneli**, stres
160, model galerisi ve tek dosya build'i; hiçbir konsol hatası olmamalı. Ekran görüntüleri `test-output/`.

## 6. Performans önlemleri

**Simülasyon:** manga başına yol bulma (asker başına A* yok) + tick başına 4 istek + **tick başına A* iş bütçesi**
(12 000 düğüm; bir dalganın uzun yolları birkaç tick'e yayılır, önbellek isabeti de aynı maliyetle sayılır →
deterministik) + LRU önbellek; sıkışma kurtarma yolları aynı bütçeden, tick başına en fazla 2; sis 4 tick'te bir,
hedef seçimi kademeli; sınırlı oyun cesedi (360) ve krater (48). Node ölçümü (bu makine, Faz 2 sonrası, ölçüm
gürültülü): 160 asker ≈ 0.13–0.47 ms/tick, 320 asker ≈ 0.24 ms/tick, 480 asker ≈ 0.32–0.50 ms/tick; 15 dk AI'ya
karşı AI maçı ≈ 0.1–0.2 ms/tick ortalama.

**Render:** instancing (asker / prop / zemin dağınıklığı / decal / parçacık), manga ve parça bazlı frustum culling,
mesafe LOD, gölge geçişinde hafif LOD; sınırlı görsel ceset (80–300) / parçacık (700–2600) / decal havuzları;
**duman kaplama bütçesi** (büyük duman taneleri kaliteye göre boyut / ömür / ekran kaplama sınırlı — mobilde
aşırı çizim / fill-rate patlaması yok), parçacık sisi köşe başına; **piksel bütçesi** (düşük 1.0 MP, dengeli 2.1 MP,
yüksek 4.2 MP — DPR 2+ tabletlerde dev arka tampon yok) + kalite tavanını bilen dinamik çözünürlük; canvas boyutu bir
sonraki kareye ertelenir (yeniden boyutlanmada siyah kare yok); **discard'sız shader varyantı** (yalnızca şantiye
modelleri kesim varyantını kullanır → erken derinlik testi korunur); dengeli kalitede tek gölge örneği, yüksekte 4;
opak çizim sırası birimler → statikler → tahkimat → arazi (arazinin gizlenen pikselleri boyanmaz); kare sonunda
derinlik tamponu `invalidateFramebuffer` (döşemeli mobil GPU'larda bellek yazımı yok); tüm shader'lar tek seferde
derlenip bağlanır (sürücü paralel derleyebilir); kazı sonrası arazi yalnızca etkilenen parçalarda yeniden kurulur;
duraklatma menüsü açıkken 2 Hz boşta çizim; HUD 5 Hz, mini harita 10 Hz; kalite ön ayarları (düşük: gölgesiz,
DPR ≤ 1, antialias yok).

**Faz 2 vahşet / VFX bütçeleri (kaliteye göre, oynanıştan bağımsız):** uçan uzuv havuzu 12 / 32 / 64, kan gölü /
ceset lekesi 48 / 110 / 190, parçalanma olasılığı ve kan parçacığı yoğunluğu LOW'da düşük; uzuvlar ek poz satırı
(en fazla 64) olarak mevcut instanced çizime girer, gölge geçişine girmez; sinek sürüsü parçacıkları kareden bağımsız
oranla ve halka tampon içinde; kraterler arazide yalnızca değişen bölgede yeniden oyulur. Sunum CPU ölçümü (Node):
480 poz + 300 ceset (6 karede bir) + 64 uzuv + havuzlar ≈ 2.9 ms/kare. Gerçek cihaz FPS'i ölçülmedi.

**Faz 3 yaşayan dünya bütçeleri:** hayvan toplam 64 (alan başına sınır), siviller yerleşim başına en fazla 6 kişilik
tek grup (komut / yol bulma yükü yok; tehlikede sığınırken çizilmez), konvoy en fazla 8, yaralı taraf başına 10,
yakma ateşi görseli 16, dönüşen ceset sinekleri 30, yanan asker efekti 40 ile sınırlı; bölge halkası sektör başına
tek decal; noktalı çizgiler yakınlaştırmaya göre seyrekleşir. Ölçüm (Node, bu makine, gürültülü): 488 asker + 43
hayvan + 4 yerleşim + iki AI ekonomisi ≈ 0.70–0.97 ms/tick ortalama (ilk saniye hariç en kötü ≈ 10 ms); aynı makinede
saf 480 asker savaşı ≈ 0.57 ms/tick; sunum CPU: 64 dört ayaklı + 40 sivil + 8 araba pozu ≈ 0.8 ms/kare. 16 tohumluk
15 dk AI'ya karşı AI maçları: ortalama tick medyanı ≈ 0.25 ms, en kötü tick ≈ 20–30 ms (yapı yerleştirmede gezinme
katmanının yeniden kurulması — Faz 1'den bilinen). Faz 3 için de gerçek cihaz FPS'i ölçülmedi.

## 7. Bilinen sınırlamalar

- Bu geliştirme ortamında GPU yoktu; tarayıcı testleri yazılım rasterleyici (SwiftShader) ile yapıldı. Gerçek mobil
  cihaz FPS değerleri **ölçülmedi** — kalite ön ayarları, piksel bütçesi ve dinamik çözünürlük bu yüzden var.
- Mobil GPU riskleri (ölçülmedi, Faz 2): asker poz dokusu her kare aynı dokuya yükleniyor (doku döndürme yok; bazı
  sürücülerde senkron bekleme olabilir); iOS Safari'nin ANGLE/Metal katmanında `flat` varyasyonların maliyeti.
- Yapı yerleştirme / tamamlanmasında gezinme katmanları ve bağlantı bileşenleri tüm harita için yeniden kuruluyor
  (masaüstünde birkaç ms; nadir olay) — artımlı güncelleme sonraki faz.
- Denge yalnızca AI'ya karşı AI ile ölçüldü (16 tohum, 15 dk: Faz 1'de Yeni Antakya 6 / Kara Kâse 10; Faz 2
  sonrası 5 / 11; Faz 3 sonrası 10 / 6; Faz 4 sonrası 10 / 6 — Faz 4 ayarları sırasında 16/0 ile 6/10 arasında oynadı,
  yani AI önceliklerine çok duyarlı); insan oyuncuyla denge testi yok. Ölçümler: `npm run balance`.
- Faz 4: Kara Kâse organik savunmaları AI'ya karşı AI'da neredeyse hiç ateş etmedi (Yeni Antakya AI'sı derin karşı
  saldırı yapmıyor); sahra topu 16 maçın 10'unda devreye girdi. Harabe çöküşünde duvar modeli değişmiyor (moloz yığını +
  toz eklenir). Sesin gerçek telefonda dinleme testi yapılmadı.
- Faz 3: Kâse biyokütlesinde hayvan payı düşük (%2–12, toplamda ≈ %4) — tasarım gereği hayvan değeri düşük; sunak
  pasif payı ≈ %21 (%14–39). AI'ya karşı AI'da konvoylar hiç yağmalanmadı (202 varış / 0 kayıp) — konvoy baskını
  kodu var ama AI nadiren fırsat buluyor. Yeni Antakya AI'sı yerleşimlerin yaklaşık yarısını kaybediyor (38 kuruldu,
  17 düştü, 20 tahliye).
- Ağ kodu yok (mimari lockstep'e hazır: deterministik sim + tick'li düz komutlar + komut günlüğü).
- Tek harita / tek senaryo (siege). Tank, topçu birimleri, hava durumu etkileri, kampanya yok (alev takımı Faz 3'te
  geldi). Sivil ihtiyaç yapay zekâsı, şehir yönetimi, hayvan üretme simülasyonu bilinçli olarak yok.
- Animasyonlar prosedürel (keyframe dosyası yok); yüz ve parmak ayrıntısı yok.
- Ses ve müzik tamamen sentez; gerçek telefon hoparlöründe dinleme testi yapılmadı (frekans bandı buna göre seçildi).
- Vahşet görselleri yalnızca yazılım rasterleyicide (SwiftShader) ekran görüntüsüyle kontrol edildi.
- Yol bulma manga düzeyinde; çok kalabalık darboğazlarda askerler kısa süre birbirine takılabilir.

## 8. Yol haritası

[`docs/ROADMAP.md`](docs/ROADMAP.md) — faz planı (sonraki: gerçek cihazda Faz 3 profili, insanla denge testi,
konvoy / yerleşim savunma AI'sı, ikinci harita, hava durumu, kampanya, çok oyunculu lockstep).

## Lisans / telif

Trench Crusade © ilgili hak sahipleri. Bu depo resmî değildir, ticari değildir; oyunun kodu ve prosedürel
varlıkları bu proje kapsamında yazılmıştır, dış model/doku/ses kullanılmamıştır.
