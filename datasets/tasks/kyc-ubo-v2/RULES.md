# The rules behind the kyc-ubo-v2 answer key

Every answer in `references/` is computed by `gen/solve.mjs` from these rules.
Each rule is quoted from its source. The candidate is not shown this file: the
prompt names only § 3 GwG and BVA practice, so the set tests whether a model
knows them.

Sources:
- **GwG** — § 3 Geldwäschegesetz, https://www.gesetze-im-internet.de/gwg_2017/__3.html
- **FAQ** — Bundesverwaltungsamt, *Transparenzregister: Fragen und Antworten zum
  Geldwäschegesetz (GwG)*, Stand 05. Mai 2023

## R1 · More than 25% of capital or of voting rights

> natürliche Person als wirtschaftlich Berechtigte, die unmittelbar oder mittelbar
> Eigentümer von mehr als 25 % des Kapitals sind, mehr als 25 % der Stimmrechte
> kontrollieren oder auf vergleichbare Weise Kontrolle ausüben — FAQ, Teil 1 B

Either is enough: a holder of non-voting shares can qualify on capital, and a
holder of fewer shares can qualify on votes. Exactly 25% is not more than 25%
(6.250,00 of 25.000,00 EUR does not qualify; 6.251,00 does).

## R2 · Shares a person holds are added up

A person listed with several shares (several laufende Nummern in a GmbH list,
several numbered Einlagen in a KG extract) holds their sum.

## R3 · Direct and controlled-entity holdings are added, in full

> Kontrolliert eine natürliche Person mittelbar und unmittelbar Kapitalanteile oder
> Stimmrechte, sind die einzelnen Anteile zusammenzurechnen. — FAQ, Teil 1 B I Nr. 6

> Eine anteilige Berechnung oder prozentuale Durchrechnung der Beteiligung ist nicht
> zulässig. — FAQ, Teil 1 B III Nr. 5

A controlled entity's whole stake is attributed to its controller; stakes are
never multiplied through a chain.

## R4 · Several controlled entities count together

> Mittelbare Kontrolle liegt insbesondere vor, wenn entsprechende Anteile von einer
> oder mehreren Vereinigungen nach § 20 Absatz 1 gehalten werden, die von einer
> natürlichen Person kontrolliert werden. — GwG § 3 Abs. 2 S. 3

## R5 · Control of an entity means more than 50% of its voting rights

> Für eine Beherrschung sind in der Regel Kapitalanteile oder Stimmrechte von über
> 50 % erforderlich. — FAQ, Teil 1 B

> Ein beherrschender Einfluss existiert u. a. durch eine Beteiligung von über 50 % der
> Stimmrechte an der Muttergesellschaft — FAQ, Teil 1 B III Nr. 5

Exactly 50% is not control. Control passes down a chain of controlled entities.
In this set capital and votes are the same in every intermediate entity, so
"in der Regel" never has to be read.

## R6 · Own shares are left out of the base

> Zur Ermittlung des/der wirtschaftlich Berechtigten müssen die von der Vereinigung
> selbst gehaltenen Kapitalanteile herausgerechnet werden. — FAQ, Teil 1 B I Nr. 5

## R7 · Whoever controls the general partner of a GmbH & Co. KG

> Des Weiteren üben auch Komplementäre von Kommanditgesellschaften … aufgrund ihrer
> besonderen gesellschaftsrechtlichen Stellung eine Kontrolle auf sonstige Weise …
> aus. — FAQ, Teil 1 B III Nr. 4

> Ein beherrschender Einfluss existiert u. a. … durch die Stellung als
> vertretungsberechtigter Komplementär einer KG. — FAQ, Teil 1 B III Nr. 5

The natural person who controls the sole general partner GmbH (R5) is a
beneficial owner of the KG, whatever their own limited-partner share. Every KG
in this set states that the Hafteinlagen equal the capital shares, because
the FAQ warns they need not (Teil 3, KG).

## R8 · Nobody qualifies: the legal representatives

> Wenn keine natürliche Person als tatsächlich wirtschaftlich Berechtigter ermittelt
> werden kann, gilt § 3 Abs. 2 S. 5 GwG. Wirtschaftlich Berechtigte sind dann alle
> gesetzlichen Vertreter. — FAQ, Teil 1 B I

> Es sind daher weder „Generalbevollmächtigte", Prokuristen, Handlungsbevollmächtigte
> oder einfache Vertreter wirtschaftlich Berechtigte. — FAQ, Teil 1 B I Nr. 8

For a GmbH these are its Geschäftsführer, not its Prokuristen.

## Left out on purpose

Trusts (Treuhand), pooling and voting agreements, veto rights, usufruct, and
capital differing from votes in an intermediate entity. The FAQ treats each as
a special case, and an item that turned on one would grade a reading, not a
rule. Every input states that no such arrangements are on file.
