# CapyDex (public site)

This repo only holds the finished public site in `docs/`. Don't edit it by hand.

It is built from the `Calculator` folder:

    cd ../Calculator
    python3 build.py --publish "what changed"

That builds the private site (with OCR) and this public one (OCR removed), then pushes both.
