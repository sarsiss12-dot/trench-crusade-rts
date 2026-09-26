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

## Birimler

| Birim | Durum | Doğrulanan | Proje yorumu |
|---|---|---|---|
| Yeoman | canon | Yeni Antakya temel piyadesi, sürgü mekanizmalı tüfek | 8 kişilik manga, cephane, siper davranışı |
| Muharebe İstihkâmcısı | canon | Mevzi tahkim edebilen uzman | İnşa / tamir / hurda toplama rolleri, otomatik pompalı tüfek seçimi, `combatUnit: false` |
| Mekanize Ağır Piyade | canon | Makine zırhlı, ağır silahlı birlik | Ağır makineli + dev çekiç donanımı, 3 kişilik manga |
| Kâse Kölesi (Grail Thrall) | canon | Ekipmansız "içi boşaltılmış kabuklar", toplu hâlde güçlenir | Sürü bonusu sayıları, ölülerden kaldırma kuralı |
| Ceset Muhafızı (Corpse Guard) | canon | Seçkin muhafız müritler | Enfekte tüfek donanımı ve sırt paraziti görseli bu projenin yorumu |
| Veba Şövalyesi (Plague Knight) | canon | Kara Kâse'nin zırhlı savaşçısı | Arma kabuğu görünümü ve veba kılıcı bu projenin yorumu |

## Yapılar ve yetenekler

| Varlık | Durum | Not |
|---|---|---|
| Beelzebub Sunağı | canon | Resmî metin: sunaklar "kurbanlarının kalıntılarından canavar sinekler biçiminde" yapılır. Üretim binası işlevi oyun soyutlamasıdır |
| Kilise Burcu (hedef) | abstraction | Yeni Antakya surlu bir kale-şehirdir (kanon); bu tek bina kuşatma hedefi olarak soyutlamadır |
| Siper, kum torbası, dikenli tel | abstraction | Siper savaşı evrenin çekirdeği; RTS siper mekanikleri soyutlamadır |
| Makineli mevzi, gözetleme kulesi, cephane sandığı, ikmal deposu, tarla | abstraction | Birinci Dünya Savaşı tahkimatlarından esinli oynanış yapıları |
| Topçu Ateşi | abstraction | Topçu taburları kanon; çağrılabilir yaylım yeteneği soyutlama |
| Sinek Sürüsü | abstraction | Cehennem sinekleri kanon motif; kullanılabilir yetenek biçimi soyutlama |

## Bilinçli olarak eklenmeyenler

Tanklar, alev makineli tanklar, Communicant'lar, Hounds / Amalgam / Fly Thrall gibi birimler resmî kaynaklarda var
ancak bu fazda uygulanmadı (bkz. `ROADMAP.md`). `scenario.techEra` alanı ileride yıl/teknoloji ön ayarları için
ayrıldı; kaynakla doğrulanmadan içerik eklenmeyecek.

## Kaynaklar

- [Trench Crusade — The Principality of New Antioch (resmî lore)](https://www.trenchcrusade.com/lore/the-principality-of-new-antioch/)
- [Trench Crusade — The Cult of the Black Grail (resmî lore)](https://www.trenchcrusade.com/lore/the-cult-of-the-black-grail/)
- [Trench Crusade — Black Grail Faction Overview](https://www.trenchcrusade.com/trench-wire/gaming/black-grail-faction-overview/)
- [Trench Companion — New Antioch warband](https://trench-companion.com/compendium/warbands/new-antioch)
- [Trench Companion — Cult of the Black Grail warband](https://trench-companion.com/compendium/warbands/cult-of-the-black-grail)
- [Wikipedia — Trench Crusade](https://en.wikipedia.org/wiki/Trench_Crusade)
