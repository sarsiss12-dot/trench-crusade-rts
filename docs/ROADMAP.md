# Yol haritası (faz planı)

Tüm fazlar **aynı kaynak ağacında** ilerler (faz klasörü / kopya proje yok). Her faz: testler yeşil, determinizm
korunur, kayıt sürümü gerekiyorsa artırılır ve göç yazılır.

## Faz 1 — Oynanabilir çekirdek (bu teslim) ✅
- Deterministik sabit adımlı simülasyon, düz JSON GameState, sürümlü kayıt + göç.
- Asimetrik kuşatma: Yeni Antakya lojistik/tahkimat, Kara Kâse ceset/enfeksiyon ekonomisi, HAZIRLIK → SAVAŞ → sonuç.
- Gerçek inşa hattı, siper tek doğruluk kaynağı, siper/cover sistemi, otomatik siper doluluğu.
- İki taraf için AI, 3 durumlu sis + asker bazlı görünürlük + sızıntısız sunum + sis hafızası (yapılar, kaynaklar,
  enfeksiyon, cesetler; kayıtla saklanır) + son bilinen konuma saldırı.
- WebGL2 renderer: instanced prosedürel askerler, gölge haritası, VFX, bütçeli cesetler, zemin dağınıklığı.
- Dokunmatik öncelikli kontrol, HUD, mini harita, menüler, TR/EN, prosedürel ses, stres modu, model galerisi.
- Mobil dayanıklılık: GPU bağlamı kaybından dönüş, başlatma hatası paneli, piksel / duman / A* iş bütçeleri.
- 132 Node testi + 9 tarayıcı kontrolü, tek dosya build.

## Faz 2 — Gerçek cihaz ve his
- Gerçek Android cihazlarda (Adreno / Mali / PowerVR) profil: GPU zamanlayıcı sorguları, kalite ön ayarı kalibrasyonu.
- Ölçüme göre: poz dokusu için doku döndürme (2–3 doku), iOS Safari'de `flat` varyasyon maliyeti, gezinme
  katmanlarının yapı değişiminde artımlı güncellenmesi, uzun A* aramalarının tick'lere bölünmesi.
- Gölge kaskadı (yakın/uzak), yumuşak parçacıklar, ekran uzayı AO (yüksek kalite), dokunmatik titreşim geri bildirimi.
- Kamera: döndürme (iki parmak burgu), birime odaklanma, olay konumuna atlama.
- Ses: tarafa özel müzik katmanları (prosedürel), menü sesleri.

## Faz 3 — İçerik (kaynakla doğrulanarak)
- Yeni Antakya: Trench Cleric, Shocktrooper, Sniper Priest, Combat Medic; tank ve alev makineli tank (resmî lore'da var).
- Kara Kâse: Fly Thrall, Hounds of the Black Grail, Amalgam, Herald of Beelzebub.
- Yeni yapılar: sığınak (dugout), iletişim siperi, havan mevzii; Kara Kâse yuva / kovan yapıları.
- `techEra` ön ayarları yalnızca resmî kaynakla doğrulandıktan sonra.

## Faz 4 — Harita ve mod çeşitliliği
- İkinci harita (sarp vadi / liman), hava durumu (yağmur → çamur hızı, sis → görüş), gece.
- Senaryolar: hat tutma, köprü savunması, rehine / ikmal konvoyu.
- Kampanya: maçlar arası kalıcı gazi mangalar, tahkimat mirası.

## Faz 5 — Çok oyunculu
- Lockstep: komutlar zaten tick + seq taşıyor; ağ katmanı (WebRTC data channel / WebSocket röle),
  giriş gecikmesi tamponu, periyodik durum özeti (stateHash) ile desenkron tespiti, tekrar oynatma (komut günlüğü).
