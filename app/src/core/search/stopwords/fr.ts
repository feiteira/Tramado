// French stop words (after the Snowball/NLTK list, with elided forms and the usual fillers).
export const fr = `
à ai aie aient aies ait as au aura aurai auraient aurais aurait auras aurez auriez aurions aurons auront
aux avaient avais avait avec avez aviez avions avoir avons ayant ayez ayons
c' ce ceci cela celà ces cet cette ceux chaque comme comment
d' dans de des du donc dont
elle elles en es est et étaient étais était étant été êtes étiez étions être eu eue eues eûmes eurent eus
eusse eussent eusses eussiez eussions eut eût eûtes eux
fûmes furent fus fusse fussent fusses fussiez fussions fut fût fûtes
ici il ils
j' je
l' la le les leur leurs lui
m' ma mais me même mes moi mon
n' ne ni nos notre nous
on ont ou où
par pas pour peu plus puis
qu' quand que quel quelle quelles quels qui quoi
s' sa sans se sera serai seraient serais serait seras serez seriez serions serons seront ses si soi soient
sois soit sommes son sont soyez soyons suis sur
t' ta te tes toi ton tous tout toute toutes très tu
un une
vos votre vous
y
alors aussi autre autres avant bien car chez depuis déjà encore enfin entre fait faire jamais
là lorsque oui non parce pendant peut quelque rien sous tant toujours trop vers voilà
euh ben bah hein hum
`.split(/\s+/).filter(Boolean);
