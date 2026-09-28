# Yol haritası (faz planı)

Tüm fazlar **aynı kaynak ağacında** ilerler (faz klasörü / kopya proje yok). Her faz: testler yeşil, determinizm
korunur, kayıt sürümü gerekiyorsa artırılır ve göç yazılır.

## Faz 1 — Oynanabilir çekirdek ✅
- Deterministik sabit adımlı simülasyon, düz JSON GameState, sürümlü kayıt + göç.
- Asimetrik kuşatma: Yeni Antakya lojistik/tahkimat, Kara Kâse ceset/enfeksiyon ekonomisi, HAZIRLIK → SAVAŞ → sonuç.
- Gerçek inşa hattı, siper tek doğruluk kaynağı, siper/cover sistemi, otomatik siper doluluğu.
- İki taraf için AI, 3 durumlu sis + asker bazlı görünürlük + sızıntısız sunum + sis hafızası (yapılar, kaynaklar,
  enfeksiyon, cesetler; kayıtla saklanır) + son bilinen konuma saldırı.
- WebGL2 renderer: instanced prosedürel askerler, gölge haritası, VFX, bütçeli cesetler, zemin dağınıklığı.
- Dokunmatik öncelikli kontrol, HUD, mini harita, menüler, TR/EN, prosedürel ses, stres modu, model galerisi.
- Mobil dayanıklılık: GPU bağlamı kaybından dönüş, başlatma hatası paneli, piksel / duman / A* iş bütçeleri.
- 132 Node testi + 9 tarayıcı kontrolü, tek dosya build.

## Faz 2 — Android geri bildirimi ✅
- Taraf farkında HOME, mobil yön jesti + serileştirilebilir `face`, düzen yönü.
- Cepheden çekilmeyen, yürüyen, ödemeli takviye; yol / kaynak kuralları.
- Yeni Antakya: sargı yeri, atölye, cephane deposu, işaret direği, toplanma noktası; 4 yeni duvar türü.
- Kara Kâse: köle çalışma takımları, ceset yığını, veba çukuru, sinek yuvası, kemik barikat; yeni sunak modeli.
- Sinek Sürüsü okunabilirliği, enfeksiyon göstergeleri, ekonomi ipuçları.
- Sunum vahşeti (parçalanma, uzuv havuzu, kan katmanları), topçu/havan görselleri, kalıcı kraterler, hasar evreleri.
- Katmanlı silah sesleri, ses bütçesi, uzak cephe, prosedürel müzik, ayrı müzik/efekt sesi.
- Kayıt sürümü 2 + göç; 157 Node testi.

## Faz 3 — Yaşayan cephe + asimetrik ekonomi ✅
- 10 kaynak bölgesi (maç başına zenginlik), sivil yerleşimler, tarla / ağıl / taş ocağı, nüfus → insan gücü, konvoylar.
- Görünür siviller: çalışma, sığınma, TAHLİYE; yerleşim kaybı.
- Otomatik istihkâmcı atama + sıra + merkeze dönüş, HUD istihkâm şeridi, harita vurgusu.
- Hayvanlar (6 tür, yaşam alanları, yavaş geri dolma), ağıl + çobanlar + acil kesim.
- Kara Kâse YİYECEK ARA bölge emri, otomatik yiyecek arama, biyokütle kaynakları, çok düşük sunak geliri.
- Ucuz Köle sürüsü (12 kişilik manga, sınırlı sürü bonusu), veba ölçeği (5 kademe) + Büyük Veba, enfekte ceset → Köle.
- Sıhhiyeci, Siper Rahibi, Hücum Alevcisi, ALANI TEMİZLE, yaralı askerler, yakma görselleri.
- 3×3 uzmanlık (geri alınamaz, 3 kart + onay), sınırlı kahraman / seçkinler, çok mangalı siper + kartlar.
- İki AI için yayılma / yiyecek arama / baskın / uzmanlık; kayıt sürümü 3 + göç; 195 Node testi.

## Faz 4 — Muharebe akışı (bu teslim) ✅
- Ses kurtarma durum makinesi + telefonda duyulur müzik + ambiyans; takviye düzeltmesi + otomatik takviye.
- Kontrol grupları 1/2/3, Çoklu Seçim UX, mobil hurda seçimi, HURDA ALANI, EKONOMİ GÖRÜNÜMÜ, sivil alarmı.
- Operasyonel duraklama, harabe garnizonu, sahra topu, komutanlar, Kara Kâse erken oyun + organik savunmalar.
- Kayıt sürümü 4 + göç; 235 Node testi.

## Faz 4.1 — Karar uyumu (tamamlandı)
- Duraklama ateşkes değil (yalnızca çatışma dışı bonuslar); komutan → pasif SEÇKİN sistemi (sınır yok, yığılmayan
  auralar, Keskin Nişancı Rahip); konumsal otomatik takviye; sunak 0.14; Köle / çalışma takımı hızları ve bağlamları;
  başlangıç Ceset Yığını; etki alanı görselleştirmesi; dünya uzayında ceset durumları + kalıcı arınma; sürükle-döndür
  yerleştirme + sahra topu yayı / yeniden yönlendirme; tek seferlik çoklu seçim; kart X'i; kaynak merceği; "neden
  yapamıyorum?"; 30 / 60 / 120 / 180 / SÜRESİZ; savunmanın sınırlı karşı taarruzu; yağmur + trafik çamuru; çöküşten
  kurtulan siviller; istihkâmcı kendini koruma; kayıt sürümü 5 + v4 göçü; 256 Node testi.

## Faz 05A — Iron Sultanate (yalnızca kaynakla doğrulanmış içerik)
- Taraf verisi, 3–4 çekirdek birim (resmî listeden), ekonomi farkı, AI; Iron Wall / Grand Cannon gibi yapılar
  yalnızca resmî kaynak doğrulamasından sonra. Kanon olmayan hiçbir şey kanon diye sunulmaz.

## Faz 05B — Heretic Legion
- Taraf verisi ve çekirdek birimler (resmî liste), Heretic tankı ancak doğrulanırsa; mevcut seçkin / aura / takviye
  sistemleriyle uyum; üç taraflı eşleşmelerde AI rol ataması.

## Faz 05C — Yeraltı ve çok oyunculu
- Yeraltı katmanı (tüneller: çamurdan etkilenmez), Burrower / Countermine; lockstep çok oyunculu (komutlar zaten
  tick + seq taşıyor, stateHash ile desenkron tespiti).
- Faz 4.1'den kalanlar: gerçek Android ölçümü (yağmur çizgileri, çamur dokusu, ceset rozetleri dahil), insanla denge
  testi (AI'ya karşı AI 30 dk'da Kara Kâse ağır basıyor), organik yuvaların AI'da neredeyse hiç ateş etmemesi,
  otomatik takviyenin ikmal baskısı (%42–85 bekleme), Yeni Antakya AI'sının keşif / karşı taarruz sıklığı.

## Faz 4b — Gerçek cihaz ve his
- Gerçek Android cihazlarda (Adreno / Mali / PowerVR) profil: GPU zamanlayıcı sorguları, kalite ön ayarı kalibrasyonu.
- Ölçüme göre: poz dokusu için doku döndürme (2–3 doku), iOS Safari'de `flat` varyasyon maliyeti, gezinme
  katmanlarının yapı değişiminde artımlı güncellenmesi, uzun A* aramalarının tick'lere bölünmesi.
- Gölge kaskadı (yakın/uzak), yumuşak parçacıklar, ekran uzayı AO (yüksek kalite), dokunmatik titreşim geri bildirimi.
- Kamera: döndürme (iki parmak burgu), birime odaklanma, olay konumuna atlama.
- Faz 2 vahşet / VFX / müziğin ve Faz 3 yaşayan dünyanın (hayvanlar, siviller, konvoylar, alev / veba efektleri)
  gerçek Android'de ölçümü (480 asker HIGH taban çizgisi: ≈40 FPS).
- İnsan oyuncuyla denge testi (Faz 3: yerleşim kaybı oranı, hayvan / sunak biyokütle payı, Büyük Veba gücü).
- AI: konvoy yağması ve yerleşim savunması (AI'ya karşı AI'da konvoy hiç düşmedi), tahliye / yeniden yerleşim ritmi.
- Duvar aralıkları için açılır/kapanır geçit; mangaların duvar arkasına otomatik dizilmesi.

## Faz 5 — İçerik (kaynakla doğrulanarak)
- Yeni Antakya: Shocktrooper; tank ve alev makineli tank (resmî lore'da var). (Sniper Priest Faz 4.1'de geldi.)
- Kara Kâse: Fly Thrall, Hounds of the Black Grail.
- Yeni yapılar: sığınak (dugout), iletişim siperi.
- `techEra` ön ayarları yalnızca resmî kaynakla doğrulandıktan sonra.

## Faz 6 — Harita ve mod çeşitliliği
- İkinci harita (sarp vadi / liman), sis → görüş, gece (yağmur → çamur Faz 4.1'de geldi).
- Senaryolar: hat tutma, köprü savunması, rehine / ikmal konvoyu.
- Kampanya: maçlar arası kalıcı gazi mangalar, tahkimat mirası.

## Faz 7 — Çok oyunculu
- Lockstep: komutlar zaten tick + seq taşıyor; ağ katmanı (WebRTC data channel / WebSocket röle),
  giriş gecikmesi tamponu, periyodik durum özeti (stateHash) ile desenkron tespiti, tekrar oynatma (komut günlüğü).
