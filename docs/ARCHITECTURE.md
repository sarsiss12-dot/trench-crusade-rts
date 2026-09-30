# Mimari — Fraksiyon / Taraf / Rol / Senaryo / Harita (Faz 05C)

Faz 05A "Yeni Antakya = savunan, Kara Kâse = saldıran" varsayımını çekirdekten söktü. Faz 05B bu sözleşmeyi
üçüncü oynanabilir fraksiyon **Demir Sultanlık** ve ayna eşleşmesiyle doğrular. Bu belge kodun kullandığı beş kavramı
ve aralarındaki sınırı tanımlar. Faz 05C bu ayrımı koruyarak bağımsız AI doktrini, uzmanlık politikası ve
seçilemeyen otonom varlıkları ekler.

| Kavram | Tanım | Kodda |
|---|---|---|
| **FACTION** | **Kim olduğun.** Birimler, yapılar, kaynaklar, ekonomi, seçkinler, uzmanlıklar, görsel/işitsel kimlik, AI doktrini. | `src/data/factions.js` (`FACTIONS`), `src/factions/*.js`, `src/ai/<faction>_ai.js` |
| **SIDE** | **Maçta hangi oyuncu/takım olduğun.** Sahip olunan her şey (manga, yapı, kaynak, sis katmanı, Salgın ölçeği, AI hafızası) taraf kimliğiyle anahtarlanır. | `state.sides`, `state.factions[sideId]`, `src/sim/sides.js` |
| **ROLE** | **Maça hangi stratejik konumda başladığın** (`attacker` / `defender`). Yalnızca başlangıç bölgesi, başlangıç paketi, hedef ilişkisi ve AI'ın başlangıç eğilimini seçer. | `state.sides[i].role`, `src/data/packages.js`, `src/data/ai.js` (`STRATEGY`) |
| **SCENARIO** | **Haritanın kuralları ve hedefleri.** Rol → bölge, hedefler (rol ile), zafer kuralı, süreler, kurulum modları, lore ön ayarı, senaryo özellikleri, hava. | `src/data/scenarios.js` |
| **MAP** | **Fiziksel savaş alanı.** Arazi, nehir, köprüler, harabeler, sektörler, yaban hayatı, bölgeler (`regions`), şeritler, doktrin planları. | `src/data/maps.js`, `src/world/*` |

## 1. Taraf kimliği (SIDE id)

- Bir fraksiyonun maçtaki **ilk** tarafının kimliği fraksiyon kimliğinin kendisidir (`new_antioch`, `black_grail`).
  Ayna maçta ikinci taraf `"<faction>~2"` olur (`new_antioch~2`). Böylece klasik maçın tüm kayıt/test
  verisi aynı kalır, ayna maç da gerçek iki ayrı taraf olur.
- `baseFaction(id)` → içerik fraksiyonu (saf, önbellekli). `sideDef(id)` → fraksiyon tanımı.
- `areHostile(a, b)` → **taraf** farklıysa düşman (nötr hiç kimsenin düşmanı değil). Ayna maçta iki taraf düşmandır.
- `sideIndex(id)` / `sideBit(id)` → sis/görüş katmanı. İlk taraf fraksiyonun indeksini alır; ikiz, fraksiyonun
  kullanmadığı en düşük katmanı alır. `FOG_LAYERS = FACTION_ORDER.length` (05B'de 3); runtime görüş kaynakları ve
  kayıt göçü de bu sayıyı kullanır. Saf fonksiyon → kayıt/yükleme güvenli.
- `contentIndex(id)` → içerik indeksi (ör. navigasyondaki fraksiyona özgü arazi hızı tabloları).

`state.factions` anahtar adı kayıt uyumluluğu için korundu; **taraf** başına durumdur ve şunları da taşır:
`faction`, `role`, `region`, `zone` (inşa/konuşlanma bölgesi, bölge verisinden kopya), `popStart`.

## 2. Senaryo sözleşmesi

```js
siege_default: {
  mode: 'siege', map: 'antioch_outskirts',
  setupModes: ['lore', 'free'],
  lore: { defender: 'new_antioch', attacker: 'black_grail' },   // Lore Setup ön ayarı (tek olası savaş değil)
  slots: ['defender', 'attacker'],                               // taraf oluşturma sırası (deterministik)
  roles: { defender: { region: 'south' }, attacker: { region: 'north' } },
  objectives: [{ id: 'defenderPrimaryObjective', type: 'primary_hq', owner: 'defender' }],
  victory: 'siege', durations: 'all', features: [], weather: {...},
}
```

Senaryo **hiçbir yerde fraksiyon adı** ile hedef, kaynak veya birlik tanımlamaz; hepsi rol ile anahtarlanır.
`features` senaryo özelliği içindir — **fraksiyon özelliği değildir**. `iron_wall_sector`, rol sahibini ve
`requiresFaction` koşulunu veriyle çözer; normal fraksiyon inşa listesine Demir Duvar eklemez.
`open_battle` (ikincil) aynı haritada kale olmadan **imha** kuralıyla oynanır.

## 3. Başlangıç paketleri

`PACKAGES[faction][role]` = kaynaklar + nüfus + yapılar + kuvvetler. Paket bir bölge için yazılır (`authored`)
ve taraf öbür bölgedeyse harita merkezine göre **nokta yansıtılır** (`sides.js placeInRegion`: `(x,z)→(W−x,H−z)`,
`rot+π`). `primary: true` tarafın birincil karargâhını işaretler; senaryonun `primary_hq` hedefi hangi role
aitse o tarafın birincil karargâhı hedef olur — fraksiyonu ne olursa olsun.

| Paket | İçerik (kimlik korunur) |
|---|---|
| Yeni Antakya savunan | Kilise Burcu (birincil), ikmal deposu, 2 tarla, 3 siper, 6 piyade + 2 istihkâm + 1 ağır |
| Yeni Antakya saldıran | **Sahra Karargâhı** (oyun soyutlaması), ikmal deposu, 1 tarla, 2 siper, aynı kuvvet, daha az nüfus |
| Kara Kâse saldıran | 3 kompakt sunak, orta eksende ceset höyüğü, sürü |
| Kara Kâse savunan | 3 sunak (birincil ortada), höyük, iç organ yuvası, evin önünde sürü |
| Demir Sultanlık savunan | Hisar, İstihkâmcı ve Toplanma Ocağı, Güvenli İkmal, tabya, iki siper duvarı ve iki hafif mevzi; Azeb perdesi + Yeniçeri rezervi / Simyager |
| Demir Sultanlık saldıran | İleri Karargâh, İstihkâmcı ve Toplanma Ocağı, siper duvarı ve hafif mevzi; hareketli sefer kuvveti; Iron Wall yok |

Başlangıç paketlerindeki `quickSlot` kalıcı entity metadatasıdır: `HQ`, `A`, `B`, `C`. UI yapı türü ya da harita
sırası tahmin etmez; `structureQuickSlots(state, side)` yalnız o SIDE'ın etiketli, yaşayan yapılarını döndürür.
`selectStructureShortcut` yalnız selection durumunu değiştirir ve kamera nesnesi almaz.

## 4. Bölgeler, planlar, şeritler

- `map.regions.south|north`: `facing` (düşmana bakış), `zone`, genel çapalar (`line`, `base`, `reserve`, `mass`,
  `support`, `elite`, `home`). Fraksiyon adlı çapa (`na_line`, `home_bg`…) kalmadı.
- Doktrin planları (`fortifyPlan` güney için, `organicPlan` kuzey için yazıldı) `planFor(sim, side, kind)` ile
  tarafın bölgesine taşınır. Saldırı şeritleri kuzeyden güneye yazılır; güneydeki taraf için yansıtılır
  (`lanesFor`).
- Kamera, HOME odağı, yerleştirme yönü ve hat önü (`chooseFront`) bölge `facing`'inden gelir.

## 5. Zafer

`state.match.victory` (senaryodan) ve `state.objectives` (`{ id, type, structureId, side, role }`):

- **SIEGE:** hedef yıkılırsa hedef sahibinin düşmanı kazanır; süre dolar ve hedef ayaktaysa sahibi kazanır
  (süresiz savaşta asla); saldıran tükenirse savunan kazanır.
- **İMHA (her iki modda):** HQ yeteneği olan yapısı (`STRUCTURES[type].hq`, isim değil) ve anlamlı savaşan gücü
  (combatUnit mangası) kalmayan taraf kaybeder → savunan karşı saldırıyla saldıranın üssünü yakıp kazanabilir.
- `open_battle`: süre dolunca sahada güçlü kalan kazanır (eşitse berabere); süresizde yalnız imha.

## 6. Veba sahipliği (taraf başına)

- `pestGain/pestLoss/pestTier…(…, side)`: her Salgın ölçeği bir tarafındır.
- Enfeksiyon yığını onu bırakan tarafı hatırlar (`m.infBy`); enfekte ceset hak iddia edeni (`c.plague`);
  enfekte zemin hücresi sahibini (`state.infection.o`, `sideIndex+1`).
- Diriliş, hasat, zemin çürümesi, bölge kredisi, arınma kaybı, yakma kaybı hep sahibine gider.
- Veba bağışıklığı, yaralanmama, "yerden çıkan" üretim, organik görsel = **yetenek bayrakları**
  (`plagueImmune`, `noWounded`, `emergingProduction`, `visual.organic`), isim karşılaştırması değil.

## 7. AI: doktrin + stratejik rol

- **Fraksiyon doktrini** (`new_antioch_ai.js`, `black_grail_ai.js`): fraksiyon nasıl savaşır.
- Demir Sultanlık doktrini (`iron_sultanate_ai.js`): Azeb perdesi, İstihkâmcı planı, Yeniçeri rezervi ve kontrollü
  karşı taarruz. Her inşa / üretim / hareket normal `aiIssue → enqueueCommand` hattından geçer.
- **Stratejik rol katmanı** (`data/ai.js STRATEGY[faction][role]`): aynı doktrin ne zaman / ne kadar
  taarruza döner. Yeni Antakya saldıran erken ve güçlü vurucu gruplar kurar, hedefe ulaşınca bir sonrakine geçer;
  Kara Kâse savunan evin önünde toplanır, kapıdaki düşmana karşılık verir, gördüğü düşmanı açıkça aşınca ya da savaş
  geç olunca taşar. Her şey komutla; sis dürüst.
- Zorluk yalnızca düşünme aralığıdır (`AI_DIFFICULTY`): kolay 20 / normal 10 / zor 6 tik.

Faz 05C katmanları ayrı hesaplanır:

1. `STRATEGY[faction][role]`: üs tutma, ilk ilerleme zamanı ve temel dalga/rezerv yükümlülükleri.
2. `DOCTRINES[faction]`: `rng.ai` ile bir kez seçilen profil; `state.ai[side].doctrine` içinde kayıtlıdır.
3. `SPECIALITIES[faction][tier]`: seçilen kartların `ai` politika çarpanları ve simülasyon bonusları.

`policyFor(state, side)` doktrin + uzmanlık politikasını salt okuma olarak birleştirir; runtime WeakMap önbelleği
kayıda girmez. Seçim değişince anahtar yenilenir. Doktrin uzmanlık ağırlıklarını çarpar; örneğin veba tehdidindeki
Fortress AI Purification seçmekten men edilmez. Görünür düşman, hafızadaki tepe güç, kayıp, üs hasarı, ekonomi,
rol ve savaş süresi `aggressionScore` üzerinde etkilidir; gizli düşman gücü okunmaz.

`settlement_defense.js` risk → sanal malzeme rezervi (%10–40) → düşman yönüne bakan tel/kum torbası/mevzi/siper
planı üretir. Kaynak rezervi yeni para değildir. Geçersiz yerleştirme malzemeyi sonsuza kadar rezerve etmez;
güvenli yerleşim ilk telden sonra üretim yapısını kurabilir. Mevcut engineer komut kuyruğu korunur.

Sultanlık Sapper'ı onarım/inşa/ham madde toplama, Yeniçeri rezervi ve Simyager desteğiyle birlikte planlanır.
BG yüklü gang'i teslimden almaz; tek gang'in ilk ekonomik turunu uzak inşaata feda etmez. Lull yalnız boş
dalgaları toparlar; ilerleyen hücumu geri çağırmaz. AI eylemleri `aiIssue → enqueueCommand` hattından çıkar.

## 8. Maç kurulumu

`resolveSides(scenario, settings)`: `settings.sides` (araçlar/testler) → `settings.setup` (Maç Kurulumu:
`{ mode, playerFaction, enemyFaction, playerRole }`) → eski ayar (`playerFaction` + senaryo lore ön ayarı).
UI yalnız bu düz veriyi üretir. Planlanan fraksiyonlar (`PLANNED_FACTIONS`) kilitli kart olarak görünür.

## 9. Yeni fraksiyon sözleşmesi

Yeni bir fraksiyon için gereken **yalnızca veri + kendi modülleri**:
`FACTIONS[id]` (kart, kaynaklar, ekonomi bayrakları), birim/yapı verisi, `PACKAGES[id].attacker|defender`,
`STRATEGY[id]`, `factions/<id>.js` mantık modülü + `ai/<id>_ai.js` doktrini, `registry` kaydı, i18n.
Çekirdekte `if (faction === …)` gerekmez. Demir Sultanlık bu sözleşmenin çalışan üçüncü uygulamasıdır. Açık bırakılan kancalar:

- Heretic Legion: savaş kampı HQ'su (`hq` etiketi), yeraltı için ileride ayrı bir katman (ayrı gelecek faz; bugün kod yok).

## 10. Bilinçli olarak yapılmayanlar

Heretic Legion, tam Demir Duvar kuşatması (kapı / merdiven / duvar üstü savaş), Grand Cannon, doğrulanmamış Salt
Tank ve gelecek araçlar, yeraltı/tünel/Burrower, çok oyunculu ağ, diplomasi. Maç sözleşmesi bugün iki SIDE üretir;
faction/fog kapasitesi üç oynanabilir içerik kimliğini ve ayna tarafları destekler.

## 11. Uzmanlık ve mobil seçim sözleşmesi

`HUD button → modal → CHOOSE_SPECIALITY → validateSpec → chooseSpec → state.factions[side].spec` hattı ortaktır.
Sultanlığın 05B'de eksik ağaç verisi `tiers[0]` erişimini çökertiyordu; 05C dokuz kartı ve veri-yok korumasını
ekler. Modal z-index 30, touch scroll ve açık/kilitli durum mesajı kullanır. `availableTier` mevcut ağacın
uzunluğuna bağlıdır; uygulanmamış faction yanlışlıkla seçilebilir boş tier açmaz.

`ui.areaSelect`: OFF → ON → box release → OFF. `ui.multiSelect`: kullanıcı tekrar basana kadar kalıcı.
Alan seçimi sticky Multi'yi tüketmez; sonraki normal drag kameraya döner. HQ/A/B/C etiketli yapı seçimidir;
helper kamera almaz ve zoom/yaw/pitch/home/lookAt çağıramaz. 1/2/3 asker gruplarıdır.

## 12. Autonomous Risen ve garnizon hücumu

Enfeksiyondan kalkanlar `autonomous: 'risen'` ve `risenState/risenNext` taşır. Aynı SIDE'a ait, 18 m içindeki
yakın zamanda doğmuş paket ilk kararlı sırayla seçilir; 16 üye sınırı vardır. Normal ücretli Thrall üretimi
bu sınıfa girmez. `commandable` seçim, picking, box/all/multi, control groups, komut sahipliği ve takviyenin
ortak sınırıdır. Otonom birim picking sırasında diğer askerleri engellemez.

`units/autonomous_risen.js`: 20 tick aralıkla RISE/SEEK/SWARM/ATTACK/DIE. Görünür savaşçı, savunmasız hedef,
düşman garnizonu, yapı ve en son haritadaki cephe yönü önceliklidir. Kendi order state'ini işler; oyuncu veya
AI'nin komutlanabilir ordusuna katılmaz. Pathfinding mevcut bütçeli kuyruktan geçer.

`st.faction === neutral` olsa bile düşman `st.holder` ve görünür occupant hücum hedefidir. `storm` emri en
yakın kapıya yollar, sonra 30 tick'te iki askeri içeri bırakır. `combat/garrison_assault.js` iç geometride
yakındaki savunucuyla saniyede en fazla dört yakın dövüş çifti çözer. `EV.MELEE`, kapı hareketi ve `contested`
durumu sunuma gider. Boşalan harabeye uygun birlik yerleşir; Thrall/Risen kapıdan çıkar. Yetersiz yol/120 sn
zaman aşımı sonsuz duvar titreşimini engeller. Gizli occupant bilgisi UI hedef doğrulamasına sızmaz.

## 13. Otomasyon ve ekonomi görünümü

`units/sanitation.js` oyuncu/AI için aynı görünür ceset ve tehdit puanlamasını sağlar. 40 tick kademeli boş
birim denetimi; engineer 72 m, alevci 18 m arar. Yakın diriliş → enfekte ceset → görünür yoğun zemin sırası,
HQ/yerleşim/savunma önceliği vardır. İnşa/onarım/kuyruk/manuel sanitasyon bozulmaz. Tehdit görevden döndürür.

`units/hunt_targets.js` AI ve oyuncu için ortak av/habitat/rota güvenliği hesabıdır. Yalnız görünen av ve
keşfedilmiş habitat; bilinen silah menzili, görünür düşman ve cephe sınırı kullanılır. `autoHunt` iş döngüsü,
`safeHunt` bağımsız risk ayarıdır. Kısa alan emri ayrı kalır. Aramalar saniyelik, başarısız hedef ve habitat
yeniden denemeleri beklemelidir; chase 65 sn/150 m/yol deneme sınırıyla sonlanır. Teslim gerçek taşıma ister.

`sim/economy_view.js` yalnız sunumun kullandığı SIDE/fog-safe salt okuma verisini üretir; 20 tick önbellek ve
128 marker tavanı vardır. Faction verisi `economyView: sectors|hunting|nodes` seçer. Harita/minimap/mercek
habitatı kaynak sektörüyle karıştırmaz; overlay simülasyon state'ini veya RNG'yi değiştirmez.

## 14. Kayıt v8 ve sunum

v5→v6→v7→v8 göçü korunur. v8 bağımsız av varsayılanlarını kurar ve eski diriliş mangalarını bilinen v7
yaratım sözleşmesiyle (`spawnTick > 0`, orijinal `cap <= reanimation.maxBodies`) özerkleştirir. Kayıp verip
tek askere düşmüş satın alınan cap=12 Thrall dönüştürülmez. Eski küçük paketler yüklemede zorla birleştirilmez;
yeni dirilişlerde yakın paket sınırı uygulanır. Yeni doktrin/av hafızası/risen/storm alanları düz kayıt verisidir.
Hızlı slotlar ve enfeksiyonun SIDE katmanları taşınır; save→load→continue hash eşitliği testlidir.

Yeni insan modelleri mevcut 14 kemikli rig, iki LOD ve instancing yolunu kullanır. Hisar modelleri ayrı
prosedürel üreticilerdir. Iron Wall dört kesim, geçit ve tabya metadata'sıyla `scenario.features` içinde kalır;
normal inşa kataloğuna girmez. Per-frame DOM yeniden kurma veya yeni asset bağımlılığı eklenmez.
