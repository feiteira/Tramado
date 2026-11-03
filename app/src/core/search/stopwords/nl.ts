// Dutch stop words (after the Snowball/NLTK list, with common particles and fillers).
export const nl = `
aan al alles als altijd andere ben bij daar dan dat de der deze die dit doch doen door dus een eens en er
ge geen geweest haar had heb hebben heeft hem het hier hij hoe hun iemand iets ik in is ja je kan kon kunnen
maar me meer men met mij mijn moet na naar niet niets nog nu of om omdat onder ons ook op over reeds te tegen
toch toen tot u uit uw van veel voor want waren was wat werd wezen wie wil worden wordt zal ze zelf zich zij
zijn zo zonder zou
wel eigenlijk gewoon even heel nou soms best echt hè ehm eh uhm hm
we wij jij jullie zullen zouden waar waarom wanneer welke welk dezelfde ieder elk alle beide
jouw onze mezelf jezelf zichzelf terwijl hoewel indien tijdens sinds sedert
aldus alleen anders binnen boven buiten daarom daarna dikwijls eerst enkele hen hierin iedereen jou juist
liever mag misschien moeten mogen net ongeveer opdat rond tenzij toe vaak verder weer weg zeer zodat zelfs
zo'n m'n d'r 't
`.split(/\s+/).filter(Boolean);
