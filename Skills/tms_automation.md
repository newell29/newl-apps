---
name: process_freight_inquiry
description: Logs into the company TMS to verify a customer and create a shipment file from raw email text.
tools: [browser]
---

1. Open the browser and navigate to: https://teamship.newl.ca/
2. Locate the username field and type my username.
3. Locate the password field and type my password.
4. Click the login button.
5. Once the dashboard loads, analyze the incoming text payload (the email). Extract the Customer Name, Mode of Transport, Origin, and Destination.
6. Navigate to the "Customers" link and click on Search Customers
7. Type the extracted Customer Name into the search bar and press search.
8. IF the customer does not appear or exist:
   - Stop immediately.
   - Return the message: "ERROR: Customer account not found in TMS."
9. IF the customer exists:
   - Click on Quotes in the top heading 
   - Click the "Add A Quote" button.
   - Type the extracted Customer Name into the Customer Lookup field and select from the dropdown list
   - Choose 'Pricing D' from the drop down list under the Ops Rep(s) field
   - Fill in the Origin, Destination, and Mode fields using the details you extracted from the email.
   - Click the "Save" button.
   - From the top of screen find the newly generated Quote Number and return it exactly.