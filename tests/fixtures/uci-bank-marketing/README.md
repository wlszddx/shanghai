# UCI Bank Marketing test fixture

This folder contains the original `bank-full.csv` file from the UCI Machine Learning Repository dataset **Bank Marketing** (dataset 222, DOI: `10.24432/C5K306`). It is a test fixture and is only loaded when the application is explicitly started with `npm run dev:test`.

- Source: https://archive.ics.uci.edu/dataset/222/bank%2Bmarketing
- Download: https://archive.ics.uci.edu/static/public/222/bank+marketing.zip
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
- Source row count: 45,211
- Target: `y` records whether the client subscribed to a term deposit (`yes` or `no`)
- Context: historical phone marketing campaigns by a Portuguese banking institution; this is not exhibition or B2B lead data.

The file is preserved as distributed. The application derives temporary display identifiers for the first three rows when testing UI handling. Those records stay read-only and are excluded from business lead storage, statistics, and Agent analysis.

Citation: Moro, S., Rita, P., & Cortez, P. (2014). *Bank Marketing* [Dataset]. UCI Machine Learning Repository. https://doi.org/10.24432/C5K306.
