# MiniMax H3 model notice

The source code in this repository is Apache-2.0 licensed. The MiniMax H3 model
weights are separate and are **not** distributed by this repository.

MiniMax H3 is released under the
[MiniMax H3 Community License Agreement](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE),
not an OSI-approved open-source license. As released on August 2, 2026, that
license excludes use in the United States, European Union, United Kingdom,
Republic of Korea, and other use outside its defined Applicable Territory. It
also imposes acceptable-use, hosted-service, attribution, and commercial terms.

Read the model license before running `npm run setup`, which downloads the
weights to your Modal account. This notice is not legal advice or a substitute
for reading the model license. Anyone deploying or sharing this service is
responsible for confirming that their users, infrastructure, safeguards, and use
case comply with the current license.

This repository does not enforce a Modal compute or routing region. Modal
Volumes are distributed storage; deployers are responsible for confirming that
their location, infrastructure, and users comply with MiniMax's terms.

The optional acceleration weights used by this project are the
[MiniMax-H3 Turbo LoRA](https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora),
published separately under Apache-2.0. That license does not replace or relax
the MiniMax H3 base model license described above.
