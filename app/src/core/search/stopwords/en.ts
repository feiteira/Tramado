// English stop words: function words (after the Snowball/NLTK list), contracted forms with a
// straight apostrophe (texts are folded from ’ before lookup) and transcript fillers.
export const en = `
a about above after again against ago all almost along already also although always am among an and
another any anybody anyone anything anyway anywhere are aren't around as at
be became because become been before being below beside besides between beyond both but by
can can't cannot could couldn't
did didn't do does doesn't doing don't done down during
each either else enough etc even ever every everybody everyone everything
few for from further
get gets getting got gotten
had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him himself his how how's however
i i'd i'll i'm i've if in indeed instead into is isn't it it'd it'll it's its itself
just
least less let let's
many may maybe me might mightn't mine more most much must mustn't my myself
namely neither never nevertheless next no nobody none nor not nothing now nowhere
of off often on once one ones only onto or other others otherwise ought our ours ourselves out over own
per perhaps please
quite
rather really
said same say says shall shan't she she'd she'll she's should shouldn't since so some somebody someone something
sometimes somewhat somewhere still such
than that that's the their theirs them themselves then there there's thereby therefore these they they'd they'll
they're they've thing things this those though through throughout thus to together too toward towards
under unless until up upon us
very via
was wasn't we we'd we'll we're we've well were weren't what what's whatever when when's whenever where where's
whereas wherever whether which while who who's whoever whole whom whose why why's will with within without won't
would wouldn't
yet you you'd you'll you're you've your yours yourself yourselves
um uh uhm er erm hmm mm mhm ah oh eh yeah okay ok
`.split(/\s+/).filter(Boolean);
