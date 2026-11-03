// European Portuguese stop words (after the Snowball/NLTK list, with the forms of ser, estar,
// ter, haver and ir, contractions of prepositions and articles, and transcript fillers).
export const pt = `
a à ao aos aquela aquelas aquele aqueles aquilo as às até
com como contra contudo cada
da das de dela delas dele deles depois desde dessa dessas desse desses desta destas deste destes do dos
e é ela elas ele eles em embora enquanto entre era eram éramos essa essas esse esses esta está estamos estão
estar estas estava estavam estávamos este esteja estejam estejamos estes esteve estive estivemos estiver
estivera estiveram estivéramos estiverem estivermos estivesse estivessem estivéssemos estou eu
foi fomos for fora foram fôramos forem formos fosse fossem fôssemos fui
há haja hajam hajamos hão havemos haver hei houve houvemos houver houvera houverá houveram houvéramos
houverão houverei houverem houveremos houveria houveriam houveríamos houvermos houvesse houvessem houvéssemos
isso isto já
lhe lhes lá
mais mas me mesmo mesma mesmos mesmas meu meus minha minhas muito muita muitos muitas
na nas nem no nos nós nossa nossas nosso nossos num numa nuns numas não nada
o os ou onde
para pela pelas pelo pelos perante pois por porque porquê pouco pouca poucos poucas
qual quais quando quanto quantos quanta quantas que quem
se seja sejam sejamos sem ser será serão serei seremos seria seriam seríamos sermos seu seus só sob sobre
somos sou sua suas também te tem têm temos tenha tenham tenhamos tenho terá terão terei teremos teria
teriam teríamos teu teus teve tinha tinham tínhamos tive tivemos tiver tivera tiveram tivéramos tiverem
tivermos tivesse tivessem tivéssemos tu tua tuas tudo todo toda todos todas tão
um uma umas uns
vai vão vou você vocês vos vosso vossa vossos vossas
aí ali aqui assim então ainda agora sim pronto portanto
ah eh hum hmm humm ahn pá tipo
`.split(/\s+/).filter(Boolean);
