# Yeni Antakya Kuşatması — mobil öncelikli 3D asimetrik kuşatma RTS

> **Resmî olmayan hayran projesi.** Trench Crusade evreninden esinlenmiştir. Uydurma içerik kanon olarak sunulmaz;
> her birim / yapı / yetenek verisinde `lore.status` alanı (`canon` / `canon-inspired` / `abstraction`) ve kaynak notu
> vardır. Ayrıntılar: [`docs/LORE.md`](docs/LORE.md).

HTML5 + JavaScript (native ES modules) + WebGL2 + Web Audio ile yazılmış, **harici model / doku / ses dosyası
kullanmayan** (her şey prosedürel), Android öncelikli, masaüstünde de oynanan bir kuşatma RTS'i.

- **Yeni Antakya (savunan):** siper kazar, kum torbası ve dikenli tel çeker, makineli mevzi kurar; malzeme, ikmal,
  insan gücü ve erzak ile yaşar; cephane ikmal yarıçapı ve arkadan yürüyerek gelen takviye ile savaşır.
- **Kara Kâse (saldıran):** işçi → maden → kışla yoktur; cesetleri biyokütleye çevirir, enfekte ölüleri düştükleri
  yerde yeniden kaldırır, Beelzebub sunaklarından sürü yetiştirir, vebayı toprağa yayar, sinek sürüsü salar.
- Akış: **HAZIRLIK** (hasar yok, konuşlanma bölgeleri, tahkimat) → **SAVAŞ** (süre veri ile ayarlı: 5–180 dk)
  → zafer / yenilgi (Kilise Burcu düşerse saldıran, süre dolarsa ya da saldıran tükenirse savunan kazanır).

---

## 1. Çalıştırma

Gereksinim yok (sıfır bağımlılık). Node.js ≥ 18 yalnızca geliştirme sunucusu, testler ve build için.

```bash
node tools/serve.js            # http://localhost:8080  (aynı ağdaki telefon için LAN adresi de yazdırılır)
npm test                       # = node tests/run.js      — 132 Node testi
npm run build                  # = node tools/build.js    — dist/index.html (tek dosya, çevrimdışı çalışır)
npm run balance                # = node tools/balance.js  — AI'ya karşı AI deterministik maçlar
npm run test:browser           # = node tools/browser_smoke.js — (Playwright varsa) 9 gerçek tarayıcı kontrolü
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
| **Basılı tut** (seçim varken): saldırarak ilerle | `A` saldırarak ilerle · `S` dur · `F` düzen · `R` döndür/takviye |
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

## 3. Mimari

Tek kaynak ağacı, alan (domain) bazlı modüller, **döngüsel bağımlılık yok** (test ile zorunlu), dev `game.js` yok.

```
src/
  core/         rng (sfc32, durum GameState içinde), dmath (deterministik sin/cos/atan2), events, noise
  data/         units, weapons, structures, factions, abilities, cover, terrain_types, maps, scenarios  (veri odaklı)
  world/        mapgen (katmanlı harita), terrain, nav (A* + yumuşatma + önbellek), fog, ground, structgrid
  sim/          state (JSON GameState), commands, simulation (sabit 20 Hz tick), match, perception (sis + görünürlük
                bitmaskeleri + olay filtreleme), production, abilities, scenario, runtime (yeniden kurulabilir önbellekler)
  units/        orders (manga emir makinesi, yol istek kısıtlama), movement (manga + asker yönlendirme), formation
  combat/       combat (menzil/yakın dövüş, tepki gecikmesi, ölüm → ceset), cover (arazi + siper + yönlü kum torbası)
  construction/ trench (SİPER TEK DOĞRULUK KAYNAĞI), construction (yerleştirme doğrulama → şantiye → iş → tamam)
  economy/ factions/  ortak ekonomi yardımcıları + Yeni Antakya lojistiği / Kara Kâse ceset ekonomisi
  ai/           ai (zamanlayıcı), black_grail_ai (hat bazlı dalgalar, yeniden emir), new_antioch_ai (savunma planı)
  save/         codec (sürümlü, göç zinciri, typed array base64), storage (slotlar, sandbox yalıtımı)
  render/       renderer (geçiş sırası), shaders, terrain_mesh, units_renderer (instanced skinning, poz dokusu),
                anim (prosedürel FK+IK), static_renderer, clutter, fortifications_renderer, fx, overlays,
                fog_memory, camera, gl, math3d, textures, models/ (humans, props, structures, fortifications…)
  input/        gestures (DOM'suz jest tanıyıcı), selection, pick (sise saygılı), controller (DOM bağlama)
  ui/           hud, minimap, menu, debug, i18n (TR/EN), icons (satır içi SVG), dom, style.css
  audio/        audio (Web Audio sentezi)
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
  durumdan yeniden kurulur, kayda girmez. Kayıt sürümü 1, göç zinciri mevcut.
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
- **Ekonomi:** Yeni Antakya — hurda toplama (fiziksel taşıma), depo/burçtan ikmal, erzak tarlaları, insan gücü,
  cephane + ikmal yarıçapı, arkadan yürüyen takviye. Kara Kâse — ceset hasadı, enfekte ölüleri yeniden kaldırma,
  sunaklardan üretim, enfeksiyon ızgarası, sinek sürüsü.
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

`npm test` — 132 test (Node, sıfır bağımlılık): mimari (döngü yok, katman kuralları, yasak API'ler, import konumu,
DOM'suz modüller), simülasyon, savaş, hareket (sıkışma kurtarma, cepler, katılma), inşa/siper, ekonomi, AI,
kayıt/yükleme + göç, determinizm (kayıt → yükle → devam = kesintisiz), sis (asker bazlı görünürlük, kör atış yok,
olay temizleme, düşen askerin mangasını açığa çıkarmaması), yol bulma (A* iş bütçesi, önbellekten bağımsızlık), mobil
girdi (jest eşikleri, uzun basma, pinch sonrası kaydırma, zincirli yerleştirme, Tümü kuralı, sise saygılı seçim),
sunum (sabit adım, ileri sarmada maç sonu, olay filtresi, sis hafızası yeniden kurma/yükleme, bilinen siperle zemin
oyma, i18n eksiksizliği), render (ertelenmiş canvas boyutu, piksel bütçesi, çubuk kalınlığı, artımlı arazi = tam
yeniden kurma), stres (160 ve 480 asker bütçesi). Düzeltilen her hata için bir regresyon testi eklendi.

`npm run test:browser` — başsız Chromium (GPU yoksa SwiftShader) ile 9 kontrol: menü, Yeni Antakya, dikey telefonda
Kara Kâse, dokunmatik seç + ilerle, **GPU bağlamı kaybından dönüş**, **başlatma hatasından kurtarma paneli**, stres
160, model galerisi ve tek dosya build'i; hiçbir konsol hatası olmamalı. Ekran görüntüleri `test-output/`.

## 6. Performans önlemleri

**Simülasyon:** manga başına yol bulma (asker başına A* yok) + tick başına 4 istek + **tick başına A* iş bütçesi**
(12 000 düğüm; bir dalganın uzun yolları birkaç tick'e yayılır, önbellek isabeti de aynı maliyetle sayılır →
deterministik) + LRU önbellek; sıkışma kurtarma yolları aynı bütçeden, tick başına en fazla 2; sis 4 tick'te bir,
hedef seçimi kademeli; sınırlı oyun cesedi (360). Node ölçümü (bu makine): 160 asker ≈ 0.19 ms/tick, 480 asker
≈ 0.57 ms/tick; 15 dk AI'ya karşı AI maçı ≈ 0.2–0.3 ms/tick ortalama.

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

## 7. Bilinen sınırlamalar

- Bu geliştirme ortamında GPU yoktu; tarayıcı testleri yazılım rasterleyici (SwiftShader) ile yapıldı. Gerçek mobil
  cihaz FPS değerleri **ölçülmedi** — kalite ön ayarları, piksel bütçesi ve dinamik çözünürlük bu yüzden var.
- Mobil GPU riskleri (ölçülmedi, Faz 2): asker poz dokusu her kare aynı dokuya yükleniyor (doku döndürme yok; bazı
  sürücülerde senkron bekleme olabilir); iOS Safari'nin ANGLE/Metal katmanında `flat` varyasyonların maliyeti.
- Yapı yerleştirme / tamamlanmasında gezinme katmanları ve bağlantı bileşenleri tüm harita için yeniden kuruluyor
  (masaüstünde birkaç ms; nadir olay) — artımlı güncelleme sonraki faz.
- Denge yalnızca AI'ya karşı AI ile ayarlandı (16 tohum, 15 dk: Yeni Antakya 6 / Kara Kâse 10 — iki taraf da
  kazanabiliyor); insan oyuncuyla denge testi yapılmadı.
- Ağ kodu yok (mimari lockstep'e hazır: deterministik sim + tick'li düz komutlar + komut günlüğü).
- Tek harita / tek senaryo (siege). Tank, alev makinesi, topçu birimleri, hava durumu etkileri, kampanya yok.
- Animasyonlar prosedürel (keyframe dosyası yok); yüz ve parmak ayrıntısı yok.
- Ses tamamen sentez; müzik yok.
- Yol bulma manga düzeyinde; çok kalabalık darboğazlarda askerler kısa süre birbirine takılabilir.

## 8. Yol haritası

[`docs/ROADMAP.md`](docs/ROADMAP.md) — faz planı (sonraki: gerçek cihaz profilleme, ek birimler, ikinci harita,
hava durumu, kampanya, çok oyunculu lockstep).

## Lisans / telif

Trench Crusade © ilgili hak sahipleri. Bu depo resmî değildir, ticari değildir; oyunun kodu ve prosedürel
varlıkları bu proje kapsamında yazılmıştır, dış model/doku/ses kullanılmamıştır.
