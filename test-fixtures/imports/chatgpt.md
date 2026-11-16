ChatGPT said:
Certainly! Here's a design summary you can paste into your wiki.

## Architecture

The service reads events and writes projections :rocket:

python
Copy code
def project(event):
    return {"id": event.id}

Energy is $E=mc^2$ and the area is \(\pi r^2\). The integral is

$$\int_0^1 x\,dx = \frac{1}{2}$$

Latency matters[^1] and so does cost[^2].

Term
: A word being defined.

Name	Role	Owner
API	Gateway	Ada
Worker	Queue consumer	Bob

Sources 【4†source】 suggest this approach works.

[^1]: p99 under 200 ms.
[^2]: Roughly $400 and $20 a month.

Let me know if you'd like me to expand any section!
