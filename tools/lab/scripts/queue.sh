#!/bin/bash
while ! grep -q "DONE turbo" /tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/audio/wer/times.txt; do sleep 5; done
rm -f /tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/audio/wer/times2.txt
/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/audio/../scripts/wer_run2.sh /home/feiteira/Trama/desktop/src-tauri/resources/speech/ggml-large-v3-turbo-q5_0.bin tv ref.wav dither.wav o12000.wav o16000.wav o24000.wav o32000.wav mp3v9.wav
/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/audio/../scripts/wer_run2.sh /tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/audio/dl-models/ggml-small-q5_1.bin sv ref.wav o24000.wav
/tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/audio/../scripts/wer_run2.sh /tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/audio/dl-models/ggml-base-q5_1.bin bv ref.wav o24000.wav
echo ALLDONE >> /tmp/claude-1000/-home-feiteira-Tramado/b5f09de1-3d54-4f8a-b9ef-589b61ef04d2/scratchpad/lab/audio/wer/times2.txt
