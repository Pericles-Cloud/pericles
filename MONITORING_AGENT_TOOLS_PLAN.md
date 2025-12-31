# Risk Monitoring Agent Tools

# Instructions

You are an expert AI Agent developer on the Mastra framework and an Architecture TypeScript backend developer.

You are tasked with building tools that are used for the Pericles Risk Monitoring Agent through the Mastra Agent framework.
These tools will be referenced in a prompt that the Monitoring Agent will run based on a supply chains overall risk monitoring plan.

Each tool will access the data source and be created to be called individually as a tool.

If the tool requires and API, you will create a reusable access for the tools and reduce code redudency.
Ensure that the tool can be setup and tested properly.

The credientials and API keys, if needed should be stored securely in the database, for develoment purposes an environment file can be used.

Read the documentation for each data source and create a tool that can be used for the monitoring agent.
Understand the purpose of this API and document the Agents purpose within the name of the agent and its code.

Use best practices for Mastra using the rules  @.cursor/rules/700-ai/701-mastra-agent-core-standards-auto.mdc  
Use best practices for Typescript based on the rules @.cursor/rules/300-languages/307-typescript-core-standards-auto.mdc

## Risk Categories

| # | Category | Agent Type | Primary Data Source Key |  
|---|----------|------------|-------------------------|
| 1 | Political Risk | POLITICAL_RISK_MONITOR | GDELT 
| 2 | Weather & Natural Disasters | WEATHER_DISASTER_MONITOR | NOAA, USGS, EONET 
| 3 | Economic & Financial | ECONOMIC_FINANCIAL_MONITOR | FRED 
| 4 | Maritime & Logistics | MARITIME_LOGISTICS_MONITOR | RSS 
| 5 | Labor & Social | LABOR_SOCIAL_MONITOR | RSS Feeds | RSS 
| 6 | Regulatory & Trade Policy | REGULATORY_TRADE_MONITOR | FRED 
| 7 | Pandemic & Health | PANDEMIC_HEALTH_MONITOR | WHO RSS, CDC RSS 
| 8 | Geopolitical & Conflict | GEOPOLITICAL_CONFLICT_MONITOR | GDELT 
| 9 | Cybersecurity | CYBERSECURITY_MONITOR | NVD, CISA RSS | NVD
| 10 | News & Social Media Events | REALTIME_MONITOR | X, NEWS 

# Data Source API 

# Political Risk
# Geopolitical & Conflict
# API: GDELT
http://data.gdeltproject.org/gdeltv2

# Weather & Natural Disasters
# API: NOAA
https://www.weather.gov/documentation/services-web-api
# API: EONET
https://eonet.gsfc.nasa.gov/docs/v3

# Cybersecurity
# API: NVD
https://services.nvd.nist.gov/rest/json/cves/2.0

# Financial Risk
# FRED
https://fred.stlouisfed.org/docs/api/fred/

# News
# API: NEWS
https://www.thenewsapi.com/documentation

# Social Media
# API: X
https://docs.twitterapi.io/introduction


Make sure the code is clean, use type check and linter passes.
