// Spanish (Spain) stop words (after the Snowball/NLTK list: articles, pronouns, prepositions,
// forms of ser, estar, haber and tener, and transcript fillers).
export const es = `
a al algo algunas algunos ante antes como con contra cual cuando
de del desde donde durante
e el él ella ellas ellos en entre era erais éramos eran eras eres es esa esas ese eso esos esta
está estaba estabais estábamos estaban estabas estad estada estadas estado estados estamos estando estar
estaremos estará estarán estarás estaré estaréis estaría estaríais estaríamos estarían estarías
estas estás este estemos esté estéis estén estés esto estos estoy estuve estuviera estuvierais
estuviéramos estuvieran estuvieras estuvieron estuviese estuvieseis estuviésemos estuviesen estuvieses
estuvimos estuviste estuvisteis estuvo
fue fuera fuerais fuéramos fueran fueras fueron fuese fueseis fuésemos fuesen fueses fui fuimos fuiste fuisteis
ha habéis había habíais habíamos habían habías habida habidas habido habidos habiendo habrá habrán habrás
habré habréis habremos habría habríais habríamos habrían habrías han has hasta hay haya hayáis hayamos
hayan hayas he hemos hube hubiera hubierais hubiéramos hubieran hubieras hubieron hubiese hubieseis
hubiésemos hubiesen hubieses hubimos hubiste hubisteis hubo
la las le les lo los
más me mi mí mía mías mío míos mis mucho muchos muy
nada ni no nos nosotras nosotros nuestra nuestras nuestro nuestros
o os otra otras otro otros
para pero poco por porque
que qué quien quienes
se sea seáis seamos sean seas será serán serás seré seréis seremos
sería seríais seríamos serían serías ser si sí siendo sin sobre sois somos son soy su sus suya suyas suyo suyos
también tanto te tendrá tendrán tendrás tendré tendréis tendremos tendría tendríais tendríamos tendrían
tendrías tened tenemos tenéis tenga tengáis tengamos tengan tengas tengo tenía teníais teníamos tenían
tenías tenida tenidas tenido tenidos teniendo ti tiene tienen tienes todo todos tu tú tus tuve tuviera
tuvierais tuviéramos tuvieran tuvieras tuvieron tuviese tuvieseis tuviésemos tuviesen tuvieses tuvimos
tuviste tuvisteis tuvo tuya tuyas tuyo tuyos
un una uno unos usted ustedes
vosotras vosotros vuestra vuestras vuestro vuestros
y ya yo
aquí ahí allí así entonces ahora bueno pues vale claro
eh ah mmm hmm
`.split(/\s+/).filter(Boolean);
